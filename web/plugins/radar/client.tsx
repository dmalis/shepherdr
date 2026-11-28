// Radar, the clickable prototype (dmalis/shepherdr "Radar: one place for work coming in"): one place for what might
// become work before it is a task (agents' findings, issues, errors, upstream releases), per project. Off for every
// real user twice over: offByDefault in service/next.ts PLUGINS, and only the demo's `?case=radar` sends its data
// (`snap.radar`), so without it the list's row is the Feedback plugin's, untouched.
// The list's row takes the Feedback row's place (views.feedbackRow) and opens the page in the middle (reg.middle), as
// the Feedback page does. The red item is a Triage card, so Needs you, the tab's title and push count it as they count
// every card. The row and the page come in one part, page.tsx, only when the demo sent a day: the first screen holds only this.
import { definePlugin, setUI, useSnap } from '@client/kernel.ts'
import { laterView } from '@client/later.tsx'

const PAGE = 'radar'
const RadarRow = laterView(() => import('./page.tsx').then((m) => m.RadarRow), undefined, 'radar')
const RadarPage = laterView(() => import('./page.tsx').then((m) => m.RadarPage), () => setUI({ page: null }), 'radar')

export default definePlugin({
  name: 'radar',
  setup(reg) {
    // the Feedback row stays the row wherever the demo sent no Radar day
    const Before = reg.views.feedbackRow
    reg.views.feedbackRow = function RadarOrFeedback() {
      const snap = useSnap()
      if (snap && (snap as { radar?: unknown }).radar) return <RadarRow snap={snap} />
      return Before ? <Before /> : null
    }
    reg.middle.push({ when: (ui) => ui.page === PAGE, View: () => <RadarPage /> })
  },
})
