// Radar, the clickable prototype (dmalis/shepherdr "Radar: one place for work coming in"): one place for what might
// become work before it is a task (agents' findings, issues, errors, upstream releases), per project. Never on for a
// real user: the service lists it in no Settings › Plugins and always counts it off (service/next.ts PLUGINS, demo),
// and only the demo's `?case=radar` sends its data (`snap.radar`), so even loaded (a page started while the link was
// down loads every plugin) the list's row is the Feedback plugin's, untouched.
// The list's row takes the Feedback row's place (views.feedbackRow) and opens the page in the middle (reg.middle), as
// the Feedback page does. With Feedback switched off it takes nothing, so the shell's own Feedback row (the old box)
// stays. The red item is a Triage card, so Needs you, the tab's title and push count it as they count every card. The
// row and the page come in one part, page.tsx, only when the demo sent a day: the first screen holds only this.
import { definePlugin, setUI, useSnap } from '@client/kernel.ts'
import { laterView } from '@client/later.tsx'

const PAGE = 'radar'
const RadarRow = laterView(() => import('./page.tsx').then((m) => m.RadarRow), undefined, 'radar')
const RadarPage = laterView(() => import('./page.tsx').then((m) => m.RadarPage), () => setUI({ page: null }), 'radar')

export default definePlugin({
  name: 'radar',
  setup(reg) {
    // the Feedback row stays the row wherever the demo sent no Radar day; without the Feedback plugin the shell draws
    // its own row when none is set, so Radar sets none (a wrapper drawing nothing would hide it)
    const Before = reg.views.feedbackRow
    if (Before) {
      reg.views.feedbackRow = function RadarOrFeedback() {
        const snap = useSnap()
        if (snap && (snap as { radar?: unknown }).radar) return <RadarRow snap={snap} />
        return <Before />
      }
    }
    reg.middle.push({ when: (ui) => ui.page === PAGE, View: () => <RadarPage /> })
  },
})
