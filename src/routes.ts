// custom: 'Pipeline' (src/custom/pages/Pipeline.tsx) is the freelance lead pipeline; 'Claude'
// (src/custom/claude) is the Claude teams section, listed in its own sidebar group.
export const navigation = ['Office', 'Pipeline', 'Agents', 'Usage', 'Task Board', 'Calendar', 'Activity', 'Memory', 'Folders', 'Logs', 'Settings', 'Claude'] as const
/** custom: pages of the sidebar's Hermes group (everything but the Claude section). */
export const hermesNavigation = navigation.filter((page) => page !== 'Claude')
export type Page = typeof navigation[number]

/** The page shown when the address names no page (or an unknown one). */
export const HOME: Page = 'Office'

export function pageSlug(page: Page): string {
  return page.toLowerCase().replace(/\s+/g, '-')
}

export function pageFromHash(hash: string): Page {
  const slug = hash.replace(/^#\/?/, '').split('/')[0].toLowerCase()
  if (slug === 'knowledge') return 'Memory'
  // The Dashboard's statistics now live in the Office HUD and panel.
  if (slug === 'dashboard') return 'Office'
  return navigation.find((page) => pageSlug(page) === slug) ?? HOME
}
