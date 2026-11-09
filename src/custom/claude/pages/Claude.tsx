// custom: the Claude section (#/claude, #/claude/<team>). Claude scheduled-task teams coordinate
// through Google Sheets; this page reads them through Ruang's server (server/custom/claude).
import { useEffect, useState } from 'react'
import { teamFromHash } from '../claude-view.ts'
import { ClaudeOverviewPage } from './ClaudeOverview.tsx'
import { ClaudeTeamPage } from './ClaudeTeam.tsx'
import '../claude.css'

function useClaudeTeam(): string | undefined {
  const [team, setTeam] = useState(() => (typeof window === 'undefined' ? undefined : teamFromHash(window.location.hash)))
  useEffect(() => {
    const update = () => setTeam(teamFromHash(window.location.hash))
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return team
}

export function Claude() {
  const team = useClaudeTeam()
  return team ? <ClaudeTeamPage key={team} slug={team}/> : <ClaudeOverviewPage/>
}
