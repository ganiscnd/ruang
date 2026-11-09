// custom: a small Google Sheets client for the Claude section. It logs in as the service account
// with a JWT signed by node:crypto (no Google packages) and talks to the Sheets REST API with
// fetch. The key file is read only here; the key, the access token and the service account's
// e-mail never leave this module, not even in error messages.
import { createSign } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'

export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'
const TOKEN_LIFETIME_S = 3600
/** A token is renewed this long before Google's expiry. */
const TOKEN_MARGIN_MS = 5 * 60_000
const REQUEST_TIMEOUT_MS = 10_000

export interface ServiceAccount { clientEmail: string; privateKey: string; tokenUri: string }

export class SheetsError extends Error {
  constructor(message: string, readonly kind: 'key' | 'auth' | 'not-shared' | 'not-found' | 'quota' | 'network' | 'bad-request' | 'google') { super(message) }
}

type Fetch = typeof fetch

/** Reads and checks the service account key file. Never returns its content in an error. */
export async function loadServiceAccount(file: string): Promise<ServiceAccount & { looseMode?: string }> {
  let content: string
  let mode: number
  try {
    [content, mode] = await Promise.all([readFile(file, 'utf8'), stat(file).then((info) => info.mode)])
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    throw new SheetsError(code === 'ENOENT' ? 'The Google service account key file was not found.' : `The Google service account key file cannot be read (${code ?? 'unknown error'}).`, 'key')
  }
  let raw: Record<string, unknown>
  try { raw = JSON.parse(content) as Record<string, unknown> } catch { throw new SheetsError('The Google service account key file is not valid JSON.', 'key') }
  if (raw.type !== 'service_account' || typeof raw.client_email !== 'string' || typeof raw.private_key !== 'string' || !raw.private_key.includes('PRIVATE KEY')) throw new SheetsError('The key file is not a Google service account key.', 'key')
  // The login always goes to Google's own token endpoint, whatever the file says.
  const tokenUri = TOKEN_URL
  // Group or other may read the key: worth a warning (chmod 600), not a refusal.
  const looseMode = (mode & 0o077) !== 0 ? (mode & 0o777).toString(8) : undefined
  return { clientEmail: raw.client_email, privateKey: raw.private_key, tokenUri, ...(looseMode ? { looseMode } : {}) }
}

const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url')

/** The signed assertion Google exchanges for an access token (RFC 7523, RS256). */
export function signJwt(account: ServiceAccount, scope: string, nowMs: number): string {
  const issued = Math.floor(nowMs / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64url(JSON.stringify({ iss: account.clientEmail, scope, aud: account.tokenUri, iat: issued, exp: issued + TOKEN_LIFETIME_S }))
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claims}`)
  let signature: Buffer
  try { signature = signer.sign(account.privateKey) } catch { throw new SheetsError('The service account key could not sign the login.', 'key') }
  return `${header}.${claims}.${base64url(signature)}`
}

/** A1 range on one tab; the tab name is always quoted (spaces, dots). */
export function a1(tab: string, range: string): string {
  return `'${tab.replace(/'/g, "''")}'!${range}`
}

/** Takes anything that could identify the account or a credential out of a message. */
export function redactSecrets(message: string, account?: Pick<ServiceAccount, 'clientEmail'>): string {
  let result = message
  if (account?.clientEmail) result = result.split(account.clientEmail).join('<service account>')
  return result
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '<key>')
    .replace(/[\w.+-]+@[\w-]+\.iam\.gserviceaccount\.com/g, '<service account>')
    .replace(/ya29\.[\w.-]+/g, '<token>')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<jwt>')
}

/** Turns a Google error answer into a short reason. Google's own message is not passed on. */
function googleError(status: number, body: unknown): SheetsError {
  const reason = (body as { error?: { status?: string } } | undefined)?.error?.status
  if (status === 401) return new SheetsError('Google refused the service account login.', 'auth')
  if (status === 403) return new SheetsError('The spreadsheet is not shared with the service account, or the Google Sheets API is not enabled.', 'not-shared')
  if (status === 404) return new SheetsError('The spreadsheet was not found.', 'not-found')
  if (status === 429) return new SheetsError('The Google Sheets quota is used up for now. Try again in a minute.', 'quota')
  if (status === 400) return new SheetsError(`Google refused the request${reason ? ` (${reason})` : ''}: check the tab name and ranges in the config.`, 'bad-request')
  return new SheetsError(`Google Sheets answered with an error (HTTP ${status}${reason ? `, ${reason}` : ''}).`, 'google')
}

export type CellValue = string | number | boolean
export type Rows = CellValue[][]
export type Render = 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE'

export interface SheetsApi {
  batchGet(spreadsheetId: string, ranges: string[], render?: Render): Promise<Rows[]>
}

export class SheetsClient implements SheetsApi {
  private account?: ServiceAccount
  private token?: { value: string; expires: number }

  constructor(private readonly options: { keyFile: string; fetch?: Fetch; now?: () => number }) {}

  private now(): number { return this.options.now?.() ?? Date.now() }
  private get fetch(): Fetch { return this.options.fetch ?? fetch }

  private async call(url: string, init: RequestInit): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    } catch (error) {
      const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
      throw new SheetsError(timeout ? 'Google did not answer in time.' : 'Google cannot be reached (network).', 'network')
    }
    const body = await response.json().catch(() => undefined)
    if (!response.ok) throw googleError(response.status, body)
    return body
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expires - TOKEN_MARGIN_MS > this.now()) return this.token.value
    this.account ??= await loadServiceAccount(this.options.keyFile)
    const assertion = signJwt(this.account, SHEETS_SCOPE, this.now())
    let body: unknown
    try {
      body = await this.call(this.account.tokenUri, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString() })
    } catch (error) {
      // Any refusal at the token step is a login problem (wrong or revoked key), whatever its HTTP code.
      if (error instanceof SheetsError && error.kind !== 'network') throw new SheetsError('Google refused the service account login (key revoked or wrong).', 'auth')
      throw error
    }
    const token = (body as { access_token?: unknown; expires_in?: unknown } | undefined)
    if (typeof token?.access_token !== 'string') throw new SheetsError('Google did not return an access token.', 'auth')
    const lifetime = typeof token.expires_in === 'number' ? token.expires_in : TOKEN_LIFETIME_S
    this.token = { value: token.access_token, expires: this.now() + lifetime * 1000 }
    return this.token.value
  }

  /** One request for several ranges of one spreadsheet. Rows come back as Google sends them (trailing empty cells left out). */
  async batchGet(spreadsheetId: string, ranges: string[], render: Render = 'FORMATTED_VALUE'): Promise<Rows[]> {
    const query = new URLSearchParams({ majorDimension: 'ROWS', valueRenderOption: render, dateTimeRenderOption: 'FORMATTED_STRING' })
    for (const range of ranges) query.append('ranges', range)
    const body = await this.call(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values:batchGet?${query}`, { headers: { authorization: `Bearer ${await this.accessToken()}` } }) as { valueRanges?: { values?: Rows }[] } | undefined
    const ranged = body?.valueRanges
    if (!Array.isArray(ranged) || ranged.length !== ranges.length) throw new SheetsError('Google returned an unexpected answer.', 'google')
    return ranged.map((item) => (Array.isArray(item.values) ? item.values : []))
  }
}
