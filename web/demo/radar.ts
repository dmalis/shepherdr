// `?case=radar` (dmalis/shepherdr "Radar: one place for work coming in"): the clickable prototype's fictional day. Four
// projects: Shepherdr with a grey count (what its agents keep hitting, the queue, what shipped), shop with an error from
// its error tracker that waits for your yes (red, the same card under Needs you), blog not set up yet, and garden-app
// paused. Every name, number and error here is made up.
import type { TriageCard, TriageView } from '../shared/types.ts'
import type { RadarDemo, RadarItem, Sighting } from '../plugins/radar/model.ts'

const min = 60_000, hour = 60 * min, day = 24 * hour

const WHO = ['Sticker book', 'Search migration', 'Thumbnails', 'Gift cards at checkout', 'Order history export', 'Dark mode for code blocks', 'Stock alerts by email', 'Address autocomplete', 'Coupon page redesign', 'Invoice PDFs', 'Wishlist sharing', 'Review reminders']
const seen = (now: number, n: number, note: string, every = 5 * hour): Sighting[] => Array.from({ length: n }, (_, i) => ({ who: WHO[i % WHO.length]!, at: now - 40 * min - i * every, note }))

export const RADAR_REPO = 'example/shop'
/** the error's yes card: a Triage draft in #shop's chat, so Needs you counts it as it counts every Triage card */
export const radarCard = (now: number): TriageCard => ({
  // the newest thing in #shop's chat, so it opens with nothing below it (no "question below" pill over its Yes)
  id: 'draft:f:err7', kind: 'draft', key: 'err7', copy: false, rev: 1, repo: RADAR_REPO, action: 'create', at: now - 2 * min, why: 'written', hash: 'e'.repeat(64),
  // Radar's shop starts fixes: its Yes posts the issue and starts one, and says so beside Yes
  then: 'Yes also starts a fix. You review and merge it.',
  title: 'Checkout fails with “Cannot read properties of undefined (reading ‘total’)” on an empty cart',
  body: '## What happened\n\nThe error tracker saw this 48 times since 09:10, for 31 visitors. It happens when the cart is emptied in another tab and checkout is opened.\n\n## Where\n\n`checkout/summary.ts`, line 42: the summary reads `cart.total` before the cart has loaded.\n\n## Suggested fix\n\nShow the empty cart’s message when there is no cart, instead of the summary.',
})

export function radarTriage(now: number, shopSpace: string): TriageView {
  return {
    destination: RADAR_REPO,
    files: RADAR_REPO,
    repos: { '/Users/sam/dev/shop': { repo: RADAR_REPO, stopped: null, schedule: { id: '|/Users/sam/dev/shop|SHOP-TRI', paused: false, space: shopSpace, by: null } } },
    cards: [radarCard(now)],
  }
}

export function radarDay(now: number): RadarDemo {
  const days = (xs: number[]) => xs
  const items: RadarItem[] = [
    // Shepherdr: the grey count's three open items, the one 12 agents hit on top
    { id: 'r-base', project: 'shepherdr', kind: 'problem', title: 'A new task starts from an old main when main moved minutes before', sources: ['agents', 'github'], state: 'next', rank: 1, tasks: 12, trend: 'rising', workflow: 'Start',
      days: days([0, 0, 1, 0, 1, 1, 0, 2, 1, 3, 2, 4, 3, 5]), sightings: seen(now, 17, 'Started from main as it was 20 min earlier, then had to rebase'),
      reason: 'Next because 12 tasks hit it this week, up from 3 last week, and the fix is small: fetch main before the task’s branch is made.' },
    { id: 'r-badge', project: 'shepherdr', kind: 'problem', title: 'The phone’s app badge keeps a count after everything is answered', sources: ['agents'], state: 'next', rank: 2, tasks: 4, trend: 'steady', workflow: 'Phone',
      days: days([0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]), sightings: seen(now, 4, 'Badge showed 1 with nothing in Needs you', 30 * hour),
      reason: 'Second: 4 tasks hit it, steady for two weeks.' },
    { id: 'r-cap', project: 'shepherdr', kind: 'problem', title: 'Archive asks again for a task that already merged', sources: ['agents'], state: 'held', rank: 3, tasks: 3, trend: 'steady', workflow: 'Review',
      days: days([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0]), sightings: seen(now, 3, 'Archive showed “Close without merging?”', 50 * hour),
      held: { why: 'cap', words: 'Today’s 2 fixes are used.', mover: 'It starts in its turn after the cap resets tomorrow at 09:00, or now if you pick it.', act: 'Fix it now' },
      reason: 'Third in line, and today’s fixes are used.' },
    // held for the two other reasons: a source gone quiet and the base branch's checks
    { id: 'r-stale', project: 'shepherdr', kind: 'release', title: 'Upstream 3.2.26 came out', sources: ['upstream'], state: 'held', rank: 4,
      held: { why: 'stale', words: 'Upstream’s release list hasn’t answered since yesterday 18:00.', mover: 'It checks again every hour; nothing for you to do unless it stays quiet.', act: 'Check now' },
      reason: 'The sync takes it in a trial once the release list answers again.' },
    { id: 'r-checks', project: 'shepherdr', kind: 'problem', title: 'Settings › Agents forgets the model after a restart', sources: ['agents'], state: 'held', rank: 5, tasks: 2, workflow: 'Chat',
      days: days([0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]), sightings: seen(now, 2, 'Model went back to the default', 70 * hour),
      held: { why: 'checks', words: 'The required check “test” fails on main.', mover: 'The task “Main is red” is fixing it; this starts once main is green.', act: 'Open that task' },
      reason: 'Nothing starts on a red main.' },
    // being fixed now (what keeps going after Pause)
    { id: 'r-run', project: 'shepherdr', kind: 'problem', title: 'Long chats jump when an older message loads', sources: ['agents'], state: 'running', task: 'Keep the place in long chats', tasks: 6, workflow: 'Chat',
      days: days([1, 0, 1, 1, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0]), sightings: seen(now, 6, 'Scrolled back, the view jumped', 40 * hour), reason: 'Started at 10:30 under today’s first fix.' },
    // parked: comes back a week later with why
    { id: 'r-theme', project: 'shepherdr', kind: 'idea', title: 'Group recurring problems by theme', sources: ['you'], state: 'later', reason: 'Parked: wait until people filter by source.',
      later: { until: now + 5 * day, trigger: 'Back in 30 days, or sooner if 3 more report it', returned: 'Came back: 3 more reports of the same need since you parked it.' } },
    { id: 'r-voice', project: 'shepherdr', kind: 'idea', title: 'Read a task’s summary aloud when it finishes', sources: ['you'], state: 'later', reason: 'Parked until voice has its own settings page.',
      later: { until: now + 6 * day, trigger: 'Back on 4 Dec', returned: 'Came back: the date you set.' } },
    // shipped: verified live, merged but not installed, reverted
    { id: 'r-stall', project: 'shepherdr', kind: 'problem', title: 'Review stalls when the reviewer’s first turn never starts', sources: ['agents', 'github'], state: 'shipped', tasks: 9, workflow: 'Review',
      days: days([2, 3, 2, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0]), sightings: seen(now, 14, 'Reviewer sat at turn 0', 10 * hour),
      shipped: { how: 'live', at: now - 3 * day - 2 * hour, words: 'Installed Tuesday and checked healthy.', after: 'No task hit it since. 9 had in the week before.' }, reason: 'Fixed.' },
    { id: 'r-zoom', project: 'shepherdr', kind: 'problem', title: 'Zoom resets when a sheet opens', sources: ['agents'], state: 'shipped', tasks: 2, workflow: 'Phone',
      shipped: { how: 'merged', at: now - 5 * hour, words: 'Merged today at 09:40.', after: 'Not installed yet: it goes in with the next install, then Radar checks it.' }, reason: 'Fixed, not installed.' },
    { id: 'r-card', project: 'shepherdr', kind: 'problem', title: 'The review card’s buttons wrap on a phone', sources: ['agents'], state: 'shipped', tasks: 3, workflow: 'Phone',
      shipped: { how: 'reverted', at: now - day - 3 * hour, words: 'Reverted yesterday: the fix hid Merge on a narrow card.', after: 'It is open again as a new item, linked to this one.' }, reason: 'Reverted.' },
    ...Array.from({ length: 7 }, (_, i): RadarItem => ({ id: `r-old${i}`, project: 'shepherdr', kind: 'problem', title: ['Search misses a task by its key', 'The terminal loses its size on rotate', 'A chip’s Remove is hard to hit', 'Done today counts yesterday’s', 'Copy drops the last line', 'The drawer opens under the keyboard', 'The schedule’s next run shows UTC'][i]!, sources: ['agents'], state: 'shipped', tasks: 2 + (i % 3),
      shipped: { how: 'live', at: now - (2 + i * 0.6) * day, words: 'Installed and checked healthy.' }, reason: 'Fixed.' })),
    // a fresh finding from today's tasks, not sorted yet
    { id: 'r-new', project: 'shepherdr', kind: 'problem', title: 'Copy misses the last line of a code block', sources: ['agents'], state: 'new', tasks: 1, workflow: 'Chat',
      days: days([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]), sightings: seen(now, 1, 'Copied a block, pasted it without its last line'), reason: 'New today: one task noted it. Not sorted yet.' },
    { id: 'r-no', project: 'shepherdr', kind: 'idea', title: 'A second inbox for support requests', sources: ['you'], state: 'declined', reason: 'Not doing: no one owns support intake yet.' },
    // shop: the one red item (its card waits in #shop's chat and under Needs you)
    { id: 'r-err', project: 'shop', kind: 'error', title: 'Checkout fails on an empty cart', sources: ['sentry'], state: 'new', events: '48 times since 09:10 · 31 visitors', workflow: 'Start',
      needs: { card: 'triage:draft:f:err7', ask: 'Post this error as an issue in example/shop, and start a fix?', after: 'One Yes on its card does both: it posts the issue as written and starts a fix as a task. It never merges on its own: you review and merge it.' },
      reason: 'New today and rising fast: 48 times in 5 hours.' },
    { id: 'r-shop2', project: 'shop', kind: 'problem', title: 'Coupon field accepts an expired code', sources: ['github'], state: 'shipped', shipped: { how: 'live', at: now - 2 * day, words: 'Installed on the shop’s server Wednesday.' }, reason: 'Fixed.' },
    // garden-app: paused, one finished draft that posts on Resume, one parked idea
    { id: 'r-gdraft', project: 'garden', kind: 'problem', title: 'The seed list loses its order after a sync', sources: ['agents'], state: 'next', rank: 1, tasks: 2, draft: true,
      reason: 'Its issue draft was finished and scored 4 before the pause. It posts to example/garden-app once you Resume.' },
    { id: 'r-garden', project: 'garden', kind: 'idea', title: 'Water reminders by weather', sources: ['you'], state: 'later', reason: 'Parked until spring.', later: { until: now + 90 * day, trigger: 'Back on 1 Mar' } },
  ]
  // each sighting's task: as many distinct tasks as the item says hit it
  for (const i of items) if (i.sightings && i.tasks) i.sightings = i.sightings.map((x, k) => ({ ...x, who: WHO[k % i.tasks!]! }))
  return {
    looked: now - 20 * hour,
    projects: [
      { id: 'shepherdr', name: 'Shepherdr', repo: 'example/shepherdr', folder: '~/dev/shepherdr', machine: 'mac-mini', level: 'fix', fixes: { used: 2, cap: 2 }, next: '15:00',
        sources: [{ name: 'Agents', ok: true, words: 'Agents’ findings, read 2 min ago' }, { name: 'GitHub', ok: true, words: 'Issues, read 12 min ago' }, { name: 'Upstream', ok: false, words: 'Releases, no answer since yesterday 18:00' }] },
      { id: 'shop', name: 'shop', repo: RADAR_REPO, folder: '~/dev/shop', machine: 'mac-mini', level: 'fix', fixes: { used: 0, cap: 1 }, next: '15:00',
        sources: [{ name: 'Agents', ok: true, words: 'Agents’ findings, read 2 min ago' }, { name: 'GitHub', ok: true, words: 'Issues, read 8 min ago' }, { name: 'Sentry', ok: true, words: 'Errors, read 4 min ago' }] },
      { id: 'blog', name: 'blog', repo: 'example/blog', folder: '~/dev/blog', machine: 'mac-mini', level: 'none', sources: [] },
      { id: 'garden', name: 'garden-app', repo: 'example/garden-app', folder: '~/dev/garden-app', machine: 'vm', level: 'score', paused: now - 26 * hour,
        sources: [{ name: 'Agents', ok: true, words: 'Paused: nothing read since yesterday 12:00' }] },
    ],
    items,
  }
}
