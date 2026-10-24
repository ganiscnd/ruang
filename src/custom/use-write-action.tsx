// custom: preview → confirm → execute for one write action at a time.
import { useState, type ReactNode } from 'react'
import { ConfirmDialog } from './ActionDialogs.tsx'
import { previewAction, type ActionName, type ExecuteResult, type Preview } from './write-actions.ts'

/** Preview first; a refused preview shows its reason where the action was started. */
export function useWriteAction(onChanged: (result: ExecuteResult) => void) {
  const [preview, setPreview] = useState<Preview | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const start = async (action: ActionName, params: Record<string, unknown>): Promise<boolean> => {
    setBusy(true)
    setError(undefined)
    const answer = await previewAction(action, params)
    setBusy(false)
    if (!answer.ok) { setError(answer.error); return false }
    setPreview(answer.data)
    return true
  }
  const dialog: ReactNode = preview && <ConfirmDialog preview={preview} onClose={() => setPreview(undefined)} onDone={(result) => { onChanged(result); if (result.ok) setPreview(undefined) }}/>
  return { start, dialog, error, busy, clearError: () => setError(undefined) }
}
