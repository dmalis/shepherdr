// What the Feedback page says (friction loop, slice 2, #94: fork/specs/friction-loop.md), as plain functions the tests
// read. Never "Assistant", "worker" or a key: the person reads these, and an agent's name for itself is not theirs.
import type { FeedbackDraft, FeedbackList, FeedbackMatch, FeedbackRow } from '@shared/types.ts'

export const W = {
  title: 'Feedback',
  sub: 'Problems in Shepherdr itself',
  box: 'What should be better?',
  boxLabel: 'What should be better in Shepherdr',
  send: 'Send',
  saving: 'Saving…',
  saved: 'Kept under Found',
  boxOff: "Feedback offers are off in this space, so nothing was kept. Turn them on in Settings › Agents, or write from another space.",
  empty: 'Nothing found',
  emptySub: "When something in Shepherdr doesn't work as it should, your agents note it here.",
  offAll: 'Feedback offers are off for every space: agents note nothing new.',
  offAllLink: 'Open Settings',
  stale: "Couldn't read the newest list just now: showing the last one.",
  machinesLabel: 'Other machines',
  found: 'Found',
  filed: 'Filed',
  later: 'Not now',
  declined: 'Said no',
  writeUp: 'Write it up',
  notNow: 'Not now',
  never: 'Never',
  restore: 'Restore',
  undo: 'Undo',
  open: 'Open',
  onGitHub: 'On GitHub',
  noFix: 'No fix proposed yet',
  follow: 'Follow this one',
  unreachable: "GitHub isn't reachable here: this is the last check",
  checkLabel: 'What a check on GitHub found',
  // slice 4: the draft, the yes, the post
  fileIt: 'File it…',
  fileItTitle: 'File it on GitHub',
  draftLabel: 'What will be posted',
  hiddenLine: 'Shepherdr adds a hidden line at the end, so it can find this post again.',
  cancel: 'Cancel',
  postIt: 'Post it',
  postSent: 'Post it sent to',
  sendAgain: 'Send again',
  postAgain: 'Post it again',
  sendAgainHint: 'Your yes is kept: Send again on its row.',
  checkGitHub: 'Check on GitHub',
  checkAgain: 'Check again',
  checking: 'Checking…',
  foundIt: 'Found on GitHub: filed',
  // slice 5: GitHub's side of a filed issue
  trackFailed: 'GitHub isn’t reachable here: this is the last it showed',
  // slice 6: on this machine, and whether it works
  fixed: 'Fixed',
  here: 'On this machine',
  tryIt: 'Try it:',
  works: 'Works',
  broken: 'Still broken',
  worked: 'Works on this machine',
  unknown: 'This machine’s build isn’t known, so only you can tell whether the fix is here',
  worksDone: 'Noted: it works',
  brokenDone: 'Back under Found',
  backIssue: 'Its issue',
} as const

/** Not now's menu, in the order Linear's Snooze and iOS Mail's Remind me list theirs */
export const LATER: { when: 'tomorrow' | 'week' | 'again'; label: string }[] = [
  { when: 'tomorrow', label: 'Tomorrow' },
  { when: 'week', label: 'Next week' },
  { when: 'again', label: 'When it happens again' },
]

/** the person's message that asks the origin's chat to shape it (spec: "Write it up") */
export const writeUpText = (line: string) => `Write up the feedback about “${line}”`

/** a row's sections, each newest first (the service sorts) */
export function sectionsOf(list: FeedbackList | undefined) {
  const rows = list?.rows ?? []
  const of = (s: FeedbackRow['section']) => rows.filter((r) => r.section === s)
  return { found: of('found'), filed: of('filed'), later: of('later'), declined: of('declined'), fixed: of('fixed') }
}

/** a herdr space id ("sp3", "vm/sp3") and its chat's key ("p:sp3", "p:vm:sp3"), both ways (service/compat.ts placeKey).
 *  A place is found by its chat: the service names places by their space id, the demo by their chat key, and both agree
 *  on the chat. */
export const chatOfSpace = (space: string) => `p:${space.replace('/', ':')}`
export const spaceOfChat = (chat: string) => chat.replace(/^p:/, '').replace(':', '/')

/** how long ago, as the rest of the app says it: "now", "5 min ago", "2 h ago", "yesterday", "3 days ago" */
export function agoWords(at: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - at) / 60_000))
  if (m < 1) return 'now'
  if (m < 60) return `${m}\u00a0min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}\u00a0h ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d}\u00a0days ago`
}

/** who noticed it first, as people say it */
export function fromWords(r: Pick<FeedbackRow, 'from'>): string {
  const f = r.from
  if (f?.person) return 'You wrote it'
  if (f?.task) return `From the task “${f.task}”`
  if (f?.chat) return 'Noted in chat'
  if (f?.action) return `From “${f.action}”`
  return 'Noted by an agent'
}

/** the row's quiet line: who, where, on which machine (another one's, slice 8: its name), when, how often */
export function metaOf(r: FeedbackRow, where: string, now = Date.now(), machine = ''): string {
  const inWhere = where && !r.from?.task ? `in ${where}` : ''
  // a space there is already named with its machine ("~ on pi"): said once
  const on = machine && !inWhere.endsWith(` on ${machine}`) ? `on ${machine}` : ''
  const bits = [fromWords(r), ...(inWhere ? [inWhere] : []), ...(on ? [on] : []), agoWords(r.at, now)]
  if (r.count > 1) bits.push(`${r.count}\u00a0reports`)
  return bits.join(' · ')
}

/** a Not now row: when it comes back under Found */
export function backWords(until: number | null | undefined, now = Date.now()): string {
  if (until == null) return 'Comes back when it happens again'
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const days = Math.floor((until - start.getTime()) / 86_400_000)
  if (days <= 0) return 'Comes back later today'
  if (days === 1) return 'Comes back tomorrow'
  return `Comes back in ${days} days`
}

/** the person's message that asks the chat to post it (Post it); its hidden line names the draft's revision */
export const postText = (line: string) => `Post the feedback about “${line}”`

/** where a draft goes, as File it… says it first */
export function whereWords(t: FeedbackDraft['target']): string {
  if (t.action === 'create') return `A new issue in ${t.repo}`
  return t.title ? `A comment on “${t.title}” (#${t.issue}) in ${t.repo}` : `A comment on issue #${t.issue} in ${t.repo}`
}

/** where to look for a post that may have gone out: the issue it comments on, or the person's own issues in the repo */
export function lookUrl(t: FeedbackDraft['target']): string {
  return t.action === 'comment' ? `https://github.com/${t.repo}/issues/${t.issue}`
    : `https://github.com/${t.repo}/issues?q=${encodeURIComponent('is:issue author:@me')}`
}

/** each step of a post after the person's yes (slice 4), only from what herdr-task knows; null once it is filed */
export function postWords(r: Pick<FeedbackRow, 'post' | 'approved' | 'url'>): string | null {
  if (r.url || r.post?.state === 'posted') return null
  const s = r.post?.state ?? (r.approved ? 'waiting' : null)
  if (s === 'waiting') return 'Waiting to post: its chat posts it next'
  if (s === 'posting') return 'Posting…'
  if (s === 'refused') return `Couldn't post${r.post?.why ? `: ${r.post.why}` : ''}. Your yes is kept`
  if (s === 'unsure') return "Couldn't tell whether it was posted, so it won't be posted again"
  return null
}

/** a filed row's state, only from what herdr-task knows; once GitHub's side was read (slice 5), its status line says
 *  that instead of "Filed" */
export const filedWords = (r: Pick<FeedbackRow, 'state' | 'url' | 'following' | 'post' | 'approved' | 'outcome'>) =>
  r.following ? followingWords(r.following.title) : postWords(r) ?? (r.state === 'filing' ? 'Posting' : r.outcome ? '' : 'Filed')

type Outcome = NonNullable<FeedbackRow['outcome']>
type IssueState = Pick<Outcome, 'state' | 'reason'>

/** an issue's state, as GitHub's own close reasons tell it (herdr-task's feedback_track.said says the same) */
export function issueWords(o: IssueState): string {
  if (o.state === 'open') return 'Open on GitHub'
  return o.reason === 'completed' ? 'Closed as fixed' : o.reason === 'not_planned' ? 'Declined there' : o.reason === 'duplicate' ? 'Closed as a duplicate' : 'Closed'
}

/** a duplicate's canonical issue, after its title */
const whichWords = (o: IssueState) =>
  o.state === 'open' ? ', which is open' : o.reason === 'not_planned' ? ', which was declined' : `, which is ${issueWords(o).toLowerCase()}`

/** a filed row's status line (slice 5): GitHub's side of its issue, read by herdr-task --track. A duplicate names the
 *  issue GitHub says it duplicates, and takes its look from that one: fixed there is fixed. Its icon only repeats the
 *  words (GitHub's issue states pair a mark with words too); fixed is the one green */
export function outcomeWords(o: Outcome): { icon: 'check' | 'x' | 'clock' | 'copy'; fixed: boolean; lead: string; link?: { title: string; url: string }; tail?: string } {
  const c = o.state === 'closed' && o.reason === 'duplicate' ? o.canonical : undefined
  const end: IssueState = c ?? o
  const icon = end.state === 'open' ? 'clock' : end.reason === 'not_planned' ? 'x' : end.reason === 'duplicate' ? 'copy' : 'check'
  const fixed = end.state === 'closed' && end.reason === 'completed'
  if (c) return { icon, fixed, lead: 'Closed as a duplicate of ', link: { title: c.title, url: c.url }, tail: whichWords(c) }
  return { icon, fixed, lead: issueWords(o) }
}

/** a fixed row's status line (slice 6), only from what herdr-task proved: the person's Works first, then its fix on this
 *  machine (this build has the closing commit, or its install said so), then a release with it that this machine is
 *  older than, then the release alone. null: the row says GitHub's side (outcomeWords) instead */
export function shipWords(r: Pick<FeedbackRow, 'ship' | 'tried'>): { icon: 'check' | 'clock'; fixed: boolean; text: string } | null {
  if (r.tried?.result === 'works') return { icon: 'check', fixed: true, text: W.worked }
  const s = r.ship
  if (!s) return null
  if (s.here) return { icon: 'check', fixed: true, text: s.release ? `Fixed in ${s.release} · ${W.here}` : W.here }
  if (s.update && s.release) return { icon: 'clock', fixed: false, text: `Fixed in ${s.release}: update Shepherdr to get it` }
  if (s.release) return { icon: 'check', fixed: true, text: `Fixed in ${s.release}` }
  return null
}

/** whether the row asks the person to try it: its fix is here (or this machine's build isn't known), not tried yet */
export const tryable = (r: Pick<FeedbackRow, 'ship' | 'tried' | 'section'>) =>
  r.section === 'filed' && !r.tried && !!(r.ship?.here || r.ship?.unknown)

/** what to do to see the fix: the install's own words, else the first line of the draft's Expected (what should happen) */
export function tryWords(r: Pick<FeedbackRow, 'ship' | 'draft'>): string | null {
  if (r.ship?.tryIt) return r.ship.tryIt
  const m = /(?:^|\n)## Expected\n+([\s\S]*?)(?:\n## |$)/.exec(r.draft?.body ?? '')
  const t = m?.[1].trim().split('\n')[0]?.trim()
  return t ? t.slice(0, 200) : null
}

/** a row that came back under Found (slice 6): why */
export const cameBackWords = (b: NonNullable<FeedbackRow['back']>) =>
  b.why === 'broken' ? 'Came back: it still happens with its fix installed' : 'Came back: it happened again after its fix'

/** a row that follows an issue the check found (Follow this one): nothing was posted */
export const followingWords = (title: string) => `Following “${title}”`

/** what a match is, before its title (slice 3; herdr-task's feedback_check.SAID says the same): GitHub's close reason
 *  tells fixed from declined, and Shepherdr's own repo, when problems go to another one, is its makers' */
export function matchWords(m: Pick<FeedbackMatch, 'state' | 'reason' | 'makers'>): { lead: string; open: boolean } {
  const kind = m.state === 'open' ? 'open' : m.reason ?? 'closed'
  const [here, makers] = ({
    open: ['Maybe the same', "Shepherdr’s makers have it"],
    completed: ['Fixed before', "Shepherdr’s makers fixed it before"],
    not_planned: ['Declined before', "Shepherdr’s makers declined it before"],
    duplicate: ['Closed as a duplicate', "Shepherdr’s makers closed it as a duplicate"],
    closed: ['Closed before', "Shepherdr’s makers closed it"],
  } as const)[kind]
  return { lead: m.makers ? makers : here, open: kind === 'open' }
}

/** a version as numbers ("3.2.23"), else null */
const version = (v?: string) => (/^(\d+)\.(\d+)\.(\d+)$/.exec(v ?? '')?.slice(1).map(Number) ?? null)

/** a newer Shepherdr is out than the one installed: said with both versions, else null */
export function newerWords(newest?: string, installed?: string): string | null {
  const a = version(newest), b = version(installed)
  if (!a || !b) return null
  const d = a.map((x, i) => x - b[i]).find((x) => x !== 0) ?? 0
  return d > 0 ? `A newer version is out (${newest}; you have ${installed})` : null
}

/** what a call did, for its toast */
export function doneWords(what: 'later' | 'no' | 'undo', when?: string): string {
  if (what === 'no') return 'Said no: it stays out of the way'
  if (what === 'undo') return 'Back as it was'
  return when === 'again' ? 'Not now: back when it happens again' : when === 'week' ? 'Not now: back next week' : 'Not now: back tomorrow'
}

/** where Write it up goes, when it isn't the origin: why, for the row */
export function elsewhereWords(where: string, why: 'gone' | 'away' | 'asleep' | undefined, to = 'Everything', machine = ''): string {
  // another machine's row with no space there to take it (slice 8): nothing here can read that machine's record
  const goes = to ? `Write it up goes to ${to}` : `Write it up waits for a space on ${machine} to open`
  if (!why) return goes
  if (why === 'asleep') return `No chat runs in ${where} now: ${goes}`
  return why === 'gone' ? `Its space is gone: ${goes}` : `${where} can't be reached: ${goes}`
}

/** a row another machine kept that can't be acted on now (slice 8): out of reach since its last read, or older */
export function lockWords(why: 'stale' | 'old', machine: string, at: number | undefined, now = Date.now()): string {
  if (why === 'old') return `Update Shepherdr on ${machine} to act on this here`
  return at ? `${machine} can't be reached: as it was ${agoWords(at, now)}` : `${machine} can't be reached: as it was last seen`
}

/** the page's line about a linked machine whose list isn't read as it is now (slice 8) */
export function machineWords(m: NonNullable<FeedbackList['machines']>[number], name: string, now = Date.now()): string {
  if (m.state === 'none') return `Shepherdr isn't set up on ${name}, so its problems can't show here`
  if (m.state === 'old') return `${name} has an older Shepherdr: its problems show, and updating it lets you act on them here`
  return `${name} can't be reached: its problems show as they were ${agoWords(m.at, now)}`
}

export const offWords = (where: string) => `Feedback offers are off in ${where || 'its space'}: nothing more happens to it`

/** the box: which space it comes from */
export const fromBox = (where: string) => `From ${where}`
/** the box opened from a failed action's Report (slice 7): which action, and where */
export const fromAction = (label: string, where: string) => `“${label}” · From ${where}`
/** Report while the box holds an earlier report the person has added to: that one stays, to send or clear first */
export const reportWaiting = (label: string) => `Your report on “${label}” is still in the box: send or clear it first`
