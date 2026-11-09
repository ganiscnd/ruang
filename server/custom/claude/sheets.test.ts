import { createVerify, generateKeyPairSync } from 'node:crypto'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runAccessCheck } from './access-check.js'
import { parseClaudeConfig } from './config.js'
import { exampleConfig } from './example.fixture.js'
import { loadServiceAccount, redactSecrets, SHEETS_SCOPE, SheetsClient, SheetsError, signJwt, type SheetsApi } from './sheets.js'

// A throwaway key made for the test run; never a real one.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const EMAIL = 'example-bot@example-project.iam.gserviceaccount.com'
const NOW = Date.parse('2026-11-09T03:00:00Z')

async function keyFile(content: unknown = { type: 'service_account', client_email: EMAIL, private_key: PEM, token_uri: 'https://evil.example/token' }, mode = 0o600) {
  const file = path.join(await mkdtemp(path.join(tmpdir(), 'ruang-key-')), 'key.json')
  await writeFile(file, typeof content === 'string' ? content : JSON.stringify(content))
  await chmod(file, mode)
  return file
}

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString()) as Record<string, unknown>

function fakeGoogle(answers: { token?: () => Response; get?: (url: URL) => Response } = {}) {
  const calls: { url: URL; init: RequestInit }[] = []
  const fakeFetch: typeof fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input))
    calls.push({ url, init })
    if (url.hostname === 'oauth2.googleapis.com') return answers.token?.() ?? Response.json({ access_token: 'ya29.example-token', expires_in: 3600 })
    return answers.get?.(url) ?? Response.json({ valueRanges: url.searchParams.getAll('ranges').map(() => ({ values: [['ID', 'Title'], ['T01', 'Example task']] })) })
  }) as typeof fetch
  return { fetch: fakeFetch, calls }
}

describe('service account login', () => {
  it('signs an RS256 JWT for the Sheets scope that verifies with the public key', async () => {
    const account = await loadServiceAccount(await keyFile())
    // The token endpoint always is Google's, whatever the key file says.
    expect(account.tokenUri).toBe('https://oauth2.googleapis.com/token')
    const jwt = signJwt(account, SHEETS_SCOPE, NOW)
    const [header, claims, signature] = jwt.split('.')
    expect(decode(header)).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(decode(claims)).toEqual({ iss: EMAIL, scope: SHEETS_SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: NOW / 1000, exp: NOW / 1000 + 3600 })
    const verify = createVerify('RSA-SHA256')
    verify.update(`${header}.${claims}`)
    expect(verify.verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true)
  })

  it('refuses files that are not a service account key, without echoing them', async () => {
    await expect(loadServiceAccount(await keyFile({ type: 'authorized_user', client_secret: 'abc' }))).rejects.toThrow('The key file is not a Google service account key.')
    await expect(loadServiceAccount(await keyFile('{ "private_key": "-----BEGIN PRIVATE KEY-----'))).rejects.toThrow('not valid JSON')
    await expect(loadServiceAccount('/nonexistent/key.json')).rejects.toThrow('was not found')
    expect((await loadServiceAccount(await keyFile(undefined, 0o644))).looseMode).toBe('644')
  })

  it('caches the access token until shortly before it expires', async () => {
    let now = NOW
    const google = fakeGoogle()
    const client = new SheetsClient({ keyFile: await keyFile(), fetch: google.fetch, now: () => now })
    await client.batchGet('example-sheet-id-000000001', ["'Tasks'!A1:B"])
    now += 50 * 60_000
    await client.batchGet('example-sheet-id-000000001', ["'Tasks'!A1:B"])
    expect(google.calls.filter((call) => call.url.hostname === 'oauth2.googleapis.com')).toHaveLength(1)
    now += 6 * 60_000
    await client.batchGet('example-sheet-id-000000001', ["'Tasks'!A1:B"])
    expect(google.calls.filter((call) => call.url.hostname === 'oauth2.googleapis.com')).toHaveLength(2)
    const login = google.calls[0]
    expect(new URLSearchParams(String(login.init.body)).get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
  })
})

describe('Sheets reads', () => {
  it('asks for every range in one batchGet with the bearer token', async () => {
    const google = fakeGoogle()
    const client = new SheetsClient({ keyFile: await keyFile(), fetch: google.fetch, now: () => NOW })
    const [first, second] = await client.batchGet('example-sheet-id-000000001', ["'Tasks'!A1:L", "'Research ideas'!A1:K"])
    expect(first).toEqual([['ID', 'Title'], ['T01', 'Example task']])
    expect(second).toHaveLength(2)
    const read = google.calls[1]
    expect(read.url.pathname).toBe('/v4/spreadsheets/example-sheet-id-000000001/values:batchGet')
    expect(read.url.searchParams.getAll('ranges')).toEqual(["'Tasks'!A1:L", "'Research ideas'!A1:K"])
    expect(read.url.searchParams.get('valueRenderOption')).toBe('FORMATTED_VALUE')
    expect(read.init.method ?? 'GET').toBe('GET')
    expect((read.init.headers as Record<string, string>).authorization).toBe('Bearer ya29.example-token')
  })

  it.each([
    [403, 'not-shared', /not shared with the service account/],
    [404, 'not-found', /not found/],
    [429, 'quota', /quota/],
    [500, 'google', /HTTP 500/],
  ])('explains HTTP %i without passing on Google\'s text', async (status, kind, message) => {
    const google = fakeGoogle({ get: () => Response.json({ error: { status: 'X', message: `caller ${EMAIL} denied` } }, { status }) })
    const client = new SheetsClient({ keyFile: await keyFile(), fetch: google.fetch, now: () => NOW })
    const error = await client.batchGet('example-sheet-id-000000001', ['A1']).catch((caught: unknown) => caught) as SheetsError
    expect(error).toBeInstanceOf(SheetsError)
    expect(error.kind).toBe(kind)
    expect(error.message).toMatch(message)
    expect(error.message).not.toContain(EMAIL)
  })

  it('reports a refused login and a network failure', async () => {
    const refused = new SheetsClient({ keyFile: await keyFile(), fetch: fakeGoogle({ token: () => Response.json({ error: 'invalid_grant' }, { status: 400 }) }).fetch, now: () => NOW })
    await expect(refused.batchGet('example-sheet-id-000000001', ['A1'])).rejects.toMatchObject({ kind: 'auth' })
    const offline = new SheetsClient({ keyFile: await keyFile(), fetch: (async () => { throw new TypeError('fetch failed') }) as typeof fetch, now: () => NOW })
    await expect(offline.batchGet('example-sheet-id-000000001', ['A1'])).rejects.toMatchObject({ kind: 'network', message: 'Google cannot be reached (network).' })
  })

  it('redacts keys, tokens and service account addresses from any text', () => {
    const text = `x ${EMAIL} ya29.abc.def -----BEGIN PRIVATE KEY-----\nAAA\n-----END PRIVATE KEY----- eyJa.eyJb.sig`
    expect(redactSecrets(text)).toBe('x <service account> <token> <key> <jwt>')
  })
})

describe('access check', () => {
  it('reports headers, counts and value shapes, never cell text', async () => {
    const config = { ...parseClaudeConfig(exampleConfig()), keyFile: await keyFile(), icloudRoot: '/nonexistent-icloud' }
    const sheets: SheetsApi = {
      async batchGet(id) {
        if (id === 'example-sheet-id-000000003') throw new SheetsError('The spreadsheet is not shared with the service account, or the Google Sheets API is not enabled.', 'not-shared')
        if (id === 'example-sheet-id-000000001') return [[['Post date', 'Topic', 'Status', 'Owner notes'], ['2026-11-09', 'Secret topic text', 'Drafted', 'Private note']]]
        return [[['ID', 'Owner', 'Depends on', 'Status', 'Notified'], ['T01', 'ZZ.3.A', '', 'review', ''], ['T02', 'Someone', 'T01', 'waiting', '']]]
      },
    }
    const { ok, lines } = await runAccessCheck(config, sheets)
    const output = lines.join('\n')
    expect(ok).toBe(false)
    expect(output).toContain('headers: all 4 configured columns match')
    expect(output).toContain('postDate (A) format: 9999-99-99 ×1')
    expect(output).toContain('status values: drafted ×1')
    expect(output).toContain('files root: NOT FOUND')
    expect(output).toMatch(/Board example-lab \(taskflow\)\n {2}HEADERS: Column header mismatch.*AA should be "Title" but is empty/)
    expect(output).toContain('owner values: ZZ.3.A ×1, (not an agent code) ×1')
    expect(output).toMatch(/example-lab-copy.*\n {2}READ FAILED: The spreadsheet is not shared/)
    expect(output).not.toMatch(/Secret topic|Private note|Someone/)
  })
})
