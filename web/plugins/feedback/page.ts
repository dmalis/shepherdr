// fork #163: the Feedback page's code (rows.tsx, its box and its look) comes when it is first opened, or a second after
// the first screen while the page is idle (web/src/later.tsx); the list's row, its count and Report are here from the
// start.
import { getState, setUI } from '@client/kernel.ts'
import { later } from '@client/later.tsx'

export const page = later(() => import('./rows.tsx'), 'feedback')

/** open the page: the middle column on a computer, the whole screen on a phone */
export function openFeedback() {
  const phone = getState().ui.phone
  setUI({ page: 'feedback', drawer: false, search: false, settings: null, artWide: false, max: null, ...(phone ? { pane: null, task: null, art: null } : {}) })
}
