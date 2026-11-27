// The Feedback page (fork: the friction loop, slice 2, #94, fork/specs/friction-loop.md). The list's Feedback row
// shows how many problems wait under Found, as a quiet count (nothing here is urgent: Needs you keeps the only red),
// and opens the page: the middle column on a computer, the whole screen with Back on a phone. Switched off
// (Settings › Plugins), the row opens upstream's old Feedback box again.
import { definePlugin, useSnap, useUI } from '@client/kernel.ts'
import { Cnt, Row } from '@client/ui.tsx'
import { FeedbackPage, openFeedback } from './rows.tsx'
import './feedback.css'

function FeedbackRow() {
  const n = useSnap()?.feedback?.found ?? 0
  const on = useUI((u) => u.page === 'feedback')
  return <Row icon="feedback" label="Feedback" current={on || undefined} aria-label={n ? `Feedback, ${n} found` : 'Feedback'} end={<Cnt n={n} />} onClick={openFeedback} />
}

export default definePlugin({
  name: 'feedback',
  setup(reg) {
    reg.views.feedbackRow = FeedbackRow
    reg.middle.push({ when: (ui) => ui.page === 'feedback', View: () => <FeedbackPage /> })
  },
})
