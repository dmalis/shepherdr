// A fictional day for the demo (bun web/demo/serve.ts): Sam, the machines mac-mini, vm, studio and pi, the spaces
// shop, blog, notes and garden-app. Nothing here is real; it fills the same shapes the service sends, so every screen can be
// looked at, and compared with the design, without a single agent running.
import type { Automation, Catalog, Chat, Config, MachineLimits, Message, Place, Snapshot, Task, InboxItem, FeedbackList } from '../shared/types.ts'
import { demoFacts } from './machine-facts.ts'
import * as CW from '../../core/checks-wait.js'
import { plainSuggests } from '../../core/plain-suggests.js'

const NOW = Date.now()
const facts = demoFacts(NOW)
const min = 60_000
const hour = 60 * min
const day = 24 * hour
const today = (h: number, m = 0) => new Date(new Date().setHours(h, m, 0, 0)).getTime()

const place = (id: string, name: string, machine: string, x: Partial<Place> = {}): Place => ({ id, name, machine, level: 0, status: 'idle', chat: id, ...x })
export const EV = 'p:mac-mini:~'
/** a space's folder: the whole path, and as it shows (its machine's home as ~) */
const at = (folder: string, where = folder.replace(/^\/(Users|home)\/[^/]+/, '~'), x: Partial<Place> = {}): Partial<Place> => ({ folder, where, ...x })
const P = { shop: 'p:mac-mini:shop', blog: 'p:mac-mini:blog', notes: 'p:mac-mini:notes', docs: 'p:mac-mini:docs', garden: 'p:vm:garden-app', vmShop: 'p:vm:shop', vmRoot: 'p:vm:root', oldSite: 'p:mac-mini:old-site', studioSite: 'p:studio:site', vmPortal: 'p:vm:customer-portal-and-billing-redesign' }

// where a task works (SHEP-325): its space's folder unless it says otherwise; notes and the home folder are no repos
const FOLDER: Record<string, [string, string]> = { [EV]: ['/Users/sam', '~'], [P.shop]: ['/Users/sam/dev/shop', 'shop'], [P.blog]: ['/Users/sam/dev/blog', 'blog'], [P.notes]: ['/Users/sam/notes', 'notes'], [P.garden]: ['/home/sam/dev/garden-app', 'garden-app'], [P.vmShop]: ['/home/sam/clients/acme/shop', 'shop'], [P.vmRoot]: ['/home/sam/clients/acme/shop', 'shop'] }
const work = (folder: string, name: string): Task['work'] => ({ name, folder, short: folder.replace(/^\/(Users|home)\/[^/]+/, '~'), repo: !['~', 'notes'].includes(name) })
const task = (id: string, name: string, pl: string, status: Task['status'], x: Partial<Task> = {}): Task => ({ id, name, place: pl, asked: pl, status, state: status, on: pl === P.garden || pl === P.vmShop || pl === P.vmRoot ? 'vm' : 'mac-mini', created: '', age: '', work: FOLDER[pl] && work(...FOLDER[pl]), ...(FOLDER[pl] ? { taskFolder: FOLDER[pl][0] } : {}), agent: { chat: `${id}/worker`, role: 'worker', cli: pl === P.garden ? 'codex' : 'claude', status: status === 'need' ? 'need' : 'work', running: true, age: '', note: '' }, ...x })

/** the Feedback page (friction loop #94, service/feedback.ts): problems in Shepherdr itself, a fictional few */
export const feedback: FeedbackList = {
  found: 3,
  off: false,
  rows: [
    { id: 'a1f0c2', line: "The reply bubble doesn't show which message it answers", fix: 'Show the first line of the message it answers above it', kind: 'confusing', section: 'found', state: 'told', space: 'mac-mini/shop', from: { task: 'Sticker book' }, count: 3, at: NOW - 2 * hour },
    { id: 'b2e1d3', line: 'Needs you showed a task with nothing for you to do', section: 'found', state: 'found', space: 'mac-mini/~', from: { chat: true }, count: 1, at: NOW - 26 * hour },
    { id: 'c3d2e4', line: 'Scheduled tasks start twice after the machine wakes up', fix: 'Skip a start the last hour already made', kind: 'bug', section: 'found', state: 'found', space: 'vm/garden-app', from: { agent: true }, count: 2, at: NOW - 3 * day, off: true },
    { id: 'd4c3f5', line: 'A mention resolved to eleven tasks', fix: 'Mention a task by its title and open that one', kind: 'bug', section: 'filed', state: 'filed', space: 'mac-mini/blog', from: { task: 'Fix typo on the About page' }, count: 1, at: NOW - 4 * day, url: 'https://github.com/example/shepherdr/issues/12' },
    { id: 'e5b4a6', line: 'The terminal pane scrolls to the top when a task finishes', section: 'later', state: 'found', space: 'mac-mini/shop', from: { person: true }, count: 1, at: NOW - 5 * hour, until: NOW + 20 * hour },
    { id: 'f6a5b7', line: 'Settings › Agents takes two taps to open on a phone', section: 'later', state: 'found', space: 'mac-mini/notes', from: { chat: true }, count: 1, at: NOW - 2 * day, until: null },
    { id: 'a7f6c8', line: 'The window asks which space twice when a task starts', section: 'declined', state: 'declined', space: 'mac-mini/docs', from: { task: 'Website copy' }, count: 4, at: NOW - 6 * day },
  ],
}

/** the bell's list (fork #37, service/inbox.ts): a fictional week of alerts */
const alertIn = (id: string, ago: number, title: string, body: string, topic: string, place: string, x: Partial<InboxItem> = {}): InboxItem => ({ id, at: NOW - ago, title, body, topic, tag: x.task ?? id, place, url: `./?${new URLSearchParams({ place, ...(x.task ? { task: x.task } : {}) })}`, ...x })
export const inbox: InboxItem[] = [
  alertIn('need:vm:GARDEN-4/worker:p1', 5 * min, 'Task · Photo upload · Needs you', 'Wants to run a command: npm install sharp', 'needs', P.garden, { task: 'vm:GARDEN-4', waits: true }),
  alertIn('alert:a7', 40 * min, 'Task · Bigger checkout button · Approval code', 'The payment sandbox sent a code to your phone: enter it in the browser', 'needs', P.shop, { task: 'SHOP-17' }),
  alertIn('alert:a9', 50 * min, 'Schedule run · Double-check the warehouse in… · Needs review', 'Three counts differ from last week: a person should look.', 'needs', P.notes),
  alertIn('ready:BLOG-10', hour, 'Task · Fix typo on the About page · Ready for review', 'Fixed the typo and two more I found on the same page.', 'ready', P.blog, { task: 'BLOG-10', waits: true }),
  alertIn('need:SHOP-14/worker:q2', 2 * hour, 'Task · Switch payment provider · Needs you', 'Which provider, Stripe or Adyen?', 'needs', P.shop, { task: 'SHOP-14', waits: true, read: true }),
  alertIn('need:p:mac-mini:shop:q9', 3 * hour, '#shop Assistant · Needs you', 'Start the three tasks for the spring sale?', 'needs', P.shop, { waits: true, closed: NOW - 2.5 * hour, read: true }),
  alertIn('ready:NOTES-4', 3 * hour + 10 * min, 'Task · Compare supplier quotes · Ready for review', 'Brightpack is cheapest at your volume. Norbox ships fastest.', 'ready', P.notes, { task: 'NOTES-4', waits: true, read: true }),
  alertIn('done:SHOP-11', 26 * hour, 'Task · Sale banner · Done and merged', 'The banner shows on every page until Sunday.', 'done', P.shop, { task: 'SHOP-11', read: true }),
  alertIn('need:vm:GARDEN-3/worker:q4', 27 * hour, 'Task · Watering schedule · Needs you', 'Keep the old reminders, or start fresh?', 'needs', P.garden, { task: 'vm:GARDEN-3', waits: true, closed: NOW - 26 * hour, read: true }),
  alertIn('msg:p:mac-mini:blog:9', 3 * 24 * hour, '#blog Assistant · New message', 'The draft for Thursday is in the drafts folder.', 'assistant', P.blog, { read: true }),
]
// SHOP-21's checks (dmalis/shepherdr#42): lint passed in 2 min, the full check runs 6 min of its usual 14
const SHOP21_RUNS = [
  { name: 'lint', state: 'passed', at: NOW - 9 * min, end: NOW - 7 * min, typical: 2 * min },
  { name: 'check', state: 'running', at: NOW - 6 * min, end: 0, typical: 14 * min },
] as const
// its hand-in as its agent wrote it, after a compacted conversation lost the <hc suggest> form: the service reads the
// plain list into suggestions (core/plain-suggests.js), and the task's pane shows none, as nothing waits on the person
export const SHOP21_HANDIN = 'Thumbnails are in. The product list loads its pictures as small thumbnails first and swaps in the full image once it scrolls into view.\n\nThe page shows in 0.9 s on a phone, down from 1.8 s. Tests and the visual check pass here; the pull request merges by itself once GitHub\'s checks pass.\n\nLater, if you want: the same for the search results page.\n\nSuggested replies:\n- "Good, let it merge when green"\n- "Do the search page next"'

export const tasks: Task[] = [
  // SHEP-348's six states on the repo line: own branch, no PR (SHOP-19); PR checks passed (SHOP-12), failed (SHOP-15),
  // running (GARDEN-3); merged (SHOP-11); in the folder itself (BLOG-10); research, no repo (NOTES-4)
  task('SHOP-12', 'Faster product search', P.shop, 'ready', { needsAt: NOW - 8 * hour, repo: 'branch', worktree: true, branch: 'task/faster-product-search', base: 'main', pr: { number: 212, url: 'https://github.com/example/shop/pull/212', checks: 'passed' }, summary: 'Results show in about 80 ms, down from 400.', proof: 'a-shop12', waitsWhy: 'Waits for you: Merge in this repo is When I mark it as done.' }),
  task('BLOG-10', 'Fix typo on the About page', P.blog, 'ready', { needsAt: NOW - hour, repo: 'folder', summary: 'Fixed the typo and two more I found on the same page.', details: '- "Recieve" is now "Receive" in the About page heading\n- Also fixed "seperate" and "occured" further down\n- Checked: the site builds and the page reads right', waitsWhy: 'Waits for you: it worked in the folder itself, not on a branch of its own, so only you can close it.' }),
  task('NOTES-4', 'Compare supplier quotes', P.notes, 'ready', { needsAt: NOW - 3 * hour, summary: 'Brightpack is cheapest at your volume. Norbox ships fastest.', proof: 'a-quotes', waitsWhy: 'Waits for you: it worked in the folder itself, not on a branch of its own, so only you can close it.' }),
  // dmalis/shepherdr#29: a check that changed nothing waits when Merge is When I mark it as done (vm's shop), and closes
  // by itself, what it found kept in its chat line, when Merge needs no one (blog)
  task('vm:ACME-9', 'Look into the slow search page', P.vmShop, 'ready', { needsAt: NOW - 12 * min, repo: 'branch', worktree: true, branch: 'task/look-into-the-slow-search-page', base: 'main', nothingToMerge: true, leftFiles: ['notes/search-timings.md'], summary: 'The search is slow only without the price index; timings written down, no fix yet.', waitsWhy: 'Waits for you: it committed nothing but left new files (notes/search-timings.md); closing it deletes them.' }),
  task('vm:ACME-8', 'Check the coupon rounding bug', P.vmShop, 'ready', { needsAt: NOW - 25 * min, repo: 'branch', worktree: true, branch: 'task/check-the-coupon-rounding-bug', base: 'main', nothingToMerge: true, summary: 'Already fixed in the last release: coupons round to the cent. Nothing to change.', waitsWhy: 'Waits for you: Merge in this repo is When I mark it as done.' }),
  task('SHOP-14', 'Switch payment provider', P.shop, 'need', { needsAt: NOW - 2 * hour, blocked: 'question', repo: 'branch', report: { msg: 'Which provider, Stripe or Adyen?', progress: 35, paused: true } }),
  task('vm:GARDEN-4', 'Photo upload', P.garden, 'need', { agent: { chat: 'vm:GARDEN-4/worker', role: 'worker', cli: 'claude', status: 'need', running: true, age: '', note: '' }, needsAt: NOW - 5 * min, blocked: 'permission', repo: 'branch', report: { msg: 'Wants to run a command', progress: 80, paused: true } }),
  task('SHOP-17', "Download last month's invoices", P.shop, 'need', { needsAt: NOW - 4 * min, blocked: 'auth', report: { msg: 'Needs your hands: enter the sign-in code', progress: 20, paused: true } }),
  // dmalis/shepherdr#42: said ready, merges on its own, its pull request's checks still run: what it waits for, a still
  // dot, a checks card in its pane (never "Merging")
  task('SHOP-21', 'Thumbnails on the product list', P.shop, 'work', { started: NOW - 50 * min, repo: 'branch', worktree: true, branch: 'task/thumbnails-on-the-product-list', base: 'main', pr: { number: 216, url: 'https://github.com/example/shop/pull/216', checks: 'running' }, summary: 'Product list pictures load as small thumbnails first, so the page shows in half the time.', report: { msg: 'Waiting for GitHub’s checks', progress: 100 }, checksWait: CW.waitWords({ runs: SHOP21_RUNS, more: false, auto: true }) as Task['checksWait'] }),
  task('SHOP-15', 'Bigger checkout button on phones', P.shop, 'work', { started: NOW - 10 * min, repo: 'branch', worktree: true, branch: 'task/bigger-checkout-button', base: 'main', pr: { number: 214, url: 'https://github.com/example/shop/pull/214', checks: 'failed' }, report: { msg: 'Changing the button', progress: 50, eta: 13 }, blocked: 'prompt' }),
  // asked in Everything, works in shop: #shop's Tasks holds it too (SHEP-325)
  task('EV-14', 'Fix the cart badge count', EV, 'work', { started: NOW - 6 * min, repo: 'branch', work: work(...FOLDER[P.shop]), also: [P.shop], report: { msg: 'Reading the cart code', progress: 20 } }),
  // dmalis/shepherdr#131: #shop's Assistant started it in another repo: its row says "team-handbook · from #shop", so
  // "#shop only" listing it reads right
  task('SHOP-22', 'Share the review checklist', P.shop, 'work', { started: NOW - 3 * min, repo: 'branch', work: work('/Users/sam/dev/team-handbook', 'team-handbook'), report: { msg: 'Writing the checklist page', progress: 30 } }),
  // a repo no space works in: its tag still shows its tasks (SHEP-325)
  task('EV-13', 'New level select', EV, 'need', { needsAt: NOW - 20 * min, repo: 'branch', work: work('/Users/sam/dev/tor-gameboy', 'tor-gameboy'), report: { msg: 'Should locked levels show?' } }),
  task('SHOP-16', 'Dependency check', P.shop, 'work', { started: NOW - 10 * min, schedule: 'Dependency check', report: { msg: 'Updating 3 packages', progress: 85, eta: 2 } }),
  task('vm:ACME-7', 'Shipping rates by region', P.vmRoot, 'todo', { agent: undefined }),
  // Needs you 1/6 (red counts and taps): docs has one question (a tap on its count opens the card), site has two things
  // (a tap lists them), and / on vm has a task whose checks failed plus a message you haven't read (no red there)
  task('DOCS-3', 'Rewrite the setup guide', P.docs, 'need', { needsAt: NOW - 4 * min, blocked: 'question', repo: 'branch', report: { msg: 'Which install command should the guide show first?', progress: 40, paused: true } }),
  // Needs you 2/6 (dmalis/shepherdr#108): a Codex permission on vm whose chat nobody has opened still shows here and
  // in vm's shop count
  task('vm:ACME-10', 'Print the shipping labels', P.vmShop, 'need', { needsAt: NOW - 2 * min, blocked: 'permission', repo: 'branch', agent: { chat: 'vm:ACME-10/worker', role: 'worker', cli: 'codex', status: 'need', running: true, age: '', note: '' }, report: { msg: 'Wants to run a command', progress: 60, paused: true } }),
  task('studio:SITE-5', 'Contact form spam filter', P.studioSite, 'need', { on: 'studio', needsAt: NOW - 7 * min, blocked: 'permission', repo: 'branch', work: work('/Users/sam/dev/site', 'site'), report: { msg: 'Wants to run a command', progress: 70, paused: true } }),
  task('studio:SITE-6', 'Shorter cookie banner', P.studioSite, 'ready', { on: 'studio', needsAt: NOW - 50 * min, work: work('/Users/sam/dev/site', 'site'), summary: 'One short line, with Accept and Refuse side by side.', waitsWhy: 'Waits for you: Merge in this repo is When I mark it as done.' }),
  task('vm:ROOT-3', 'Order export as CSV', P.vmRoot, 'work', { started: NOW - 25 * min, repo: 'branch', worktree: true, branch: 'task/order-export', base: 'main', pr: { number: 58, url: 'https://github.com/example/shop/pull/58', checks: 'failed' }, report: { msg: 'Fixing the test that failed', progress: 60, eta: 12 } }),
  task('vm:GARDEN-3', 'Watering reminders', P.garden, 'work', { started: NOW - 30 * min, repo: 'branch', worktree: true, branch: 'task/watering-reminders', base: 'main', pr: { number: 31, url: 'https://github.com/example/garden-app/pull/31', checks: 'running' }, report: { msg: 'Writing tests', progress: 25, eta: 110 } }),
  // SHEP-321: a task just started (no % yet: the turning ring) and one stopped by an error part way
  task('SHOP-18', 'Product page copy', P.shop, 'work', { started: NOW - 2 * min, report: { msg: 'Reading the product pages' } }),
  // #1441: its agent stopped at Claude Code's folder-trust screen
  task('BLOG-12', 'Add an RSS feed', P.blog, 'need', { needsAt: NOW - 3 * min, report: { msg: 'Asks to trust this folder', paused: true } }),
  task('BLOG-11', 'Newsletter signup form', P.blog, 'need', { needsAt: NOW - 12 * min, stopped: { by: 'error', why: 'its session ended' }, report: { msg: 'Adding the form', progress: 45, paused: true } }),
  task('SHOP-19', 'Product page reviews', P.shop, 'work', { started: NOW - min, repo: 'branch', worktree: true, branch: 'task/product-page-reviews', base: 'main' }),
  task('BLOG-9', 'Dark mode for code blocks', P.blog, 'queued', { afterTitle: 'Fix typo on the About page', desc: 'Adds a dark theme to the code blocks on the blog', agent: undefined }),
  task('SHOP-13', 'Gift cards at checkout', P.shop, 'todo', { desc: 'Lets shoppers pay with a gift card at checkout', agent: undefined }),
  task('NOTES-5', "Sort last year's notes", P.notes, 'todo', { desc: "Sorts last year's notes into folders by topic", agent: undefined }),
  task('SHOP-10', 'Look for stuck work', P.shop, 'done', { doneAt: NOW - 18 * min, quiet: 'nothing', schedule: 'Look for stuck work' }),
  task('SHOP-9', 'Look for stuck work', P.shop, 'done', { doneAt: NOW - 48 * min, quiet: 'nothing', schedule: 'Look for stuck work' }),
  task('EV-21', 'Install merged', EV, 'done', { doneAt: NOW - 30 * min, quiet: 'told', doneNote: 'told you in Everything', schedule: 'Install merged' }),
  task('EV-20', 'Install merged', EV, 'done', { doneAt: NOW - 3 * hour, quiet: 'told', doneNote: 'told you in Everything', schedule: 'Install merged' }),
  task('EV-12', 'Morning brief', EV, 'done', { doneAt: NOW - 4 * hour, quiet: 'told', doneNote: 'told you in Everything', schedule: 'Morning brief' }),
  task('BLOG-6', 'Broken link check', P.blog, 'done', { doneAt: NOW - 9 * hour, merged: true, doneNote: '1 link fixed', schedule: 'Broken link check' }),
  task('BLOG-13', 'Check the broken RSS link', P.blog, 'done', { doneAt: NOW - 40 * min, needsAtWas: NOW - 40 * min, repo: 'branch', worktree: true, branch: 'task/check-the-broken-rss-link', base: 'main', nothingToMerge: true, closedAlone: true, summary: 'The link works again: the host fixed it. Nothing to change.' }),
  // dmalis/shepherdr#48: merged, then one more commit on its branch: Done, offered as a follow-up; one whose later
  // commit main already has: Already on main, nothing offered; one Working whose agent sits idle: a still dot
  task('SHOP-20', 'Reactions on reviews', P.shop, 'done', { doneAt: NOW - 25 * min, needsAtWas: NOW - 50 * min, merged: true, repo: 'branch', worktree: true, branch: 'task/reactions-on-reviews', base: 'main', pr: { number: 216, url: 'https://github.com/example/shop/pull/216' }, afterMerge: { count: 1, commits: ['Keep the reaction bar on one line on phones'], onMain: false } }),
  task('BLOG-14', 'Tag pages', P.blog, 'done', { doneAt: NOW - 3 * hour, merged: true, repo: 'branch', worktree: true, branch: 'task/tag-pages', base: 'main', pr: { number: 58, url: 'https://github.com/example/blog/pull/58' }, afterMerge: { count: 1, commits: ['Sort tags by name'], onMain: true } }),
  task('SHOP-21', 'Order confirmation email', P.shop, 'work', { started: NOW - 40 * min, agentIdle: true, repo: 'branch', worktree: true, branch: 'task/order-confirmation-email', base: 'main' }),
  task('SHOP-11', 'Fix cart rounding', P.shop, 'done', { doneAt: NOW - 7 * day, merged: true, repo: 'branch', worktree: true, branch: 'task/fix-cart-rounding', base: 'main', pr: { number: 205, url: 'https://github.com/example/shop/pull/205' } }),
  task('BLOG-8', 'New post template', P.blog, 'done', { doneAt: NOW - 7 * day, merged: true }),
  task('BLOG-7', 'Faster image loading', P.blog, 'done', { doneAt: NOW - 7 * day, merged: true }),
  // #1560: an archived task, found in the search box once something is typed
  task('BLOG-5', 'Old comment widget', P.blog, 'done', { doneAt: NOW - 30 * day, archived: NOW - 20 * day }),
  // SHEP-331: more machines, spaces and states for the Tasks filter: a stopped one, a scheduled one, two on vm's shop and root
  task('vm:ACME-3', 'Sync stock from the warehouse', P.vmShop, 'need', { on: 'vm', stopped: { by: 'error', why: 'Its agent is no longer running.' }, needsAt: NOW - 25 * min, repo: 'branch' }),
  task('vm:ACME-4', 'Nightly price export', P.vmShop, 'scheduled', { on: 'vm', desc: 'Exports prices for the shop feed at 02:00', agent: undefined }),
  task('vm:ROOT-2', 'Rotate server logs', P.vmRoot, 'work', { on: 'vm', started: NOW - 6 * min, report: { msg: 'Compressing last week', progress: 30 } }),
  // SHEP-354: a long-named space, more repos (the filter's Repo search shows past eight) and a task whose space was
  // removed (the service gives it no space: the filter must not list a blank one)
  task('vm:PORTAL-2', 'Invoice PDF layout', P.vmPortal, 'work', { on: 'vm', started: NOW - 15 * min, repo: 'branch', work: work('/home/sam/clients/northwind/portal', 'portal'), report: { msg: 'Laying out the line items', progress: 50 } }),
  task('vm:PORTAL-1', 'Billing page tests', P.vmPortal, 'todo', { on: 'vm', agent: undefined, work: work('/home/sam/dev/payments-service', 'payments-service') }),
  task('vm:PORTAL-3', 'Shared button styles', P.vmPortal, 'done', { on: 'vm', doneAt: NOW - 2 * day, merged: true, work: work('/home/sam/dev/design-system', 'design-system') }),
  task('studio:SITE-3', 'Swap the hero image', P.studioSite, 'work', { on: 'studio', started: NOW - 4 * min, repo: 'branch', work: work('/Users/sam/dev/site', 'site'), report: { msg: 'Resizing the images', progress: 60 } }),
  task('studio:SITE-4', 'App store screenshots', P.studioSite, 'todo', { on: 'studio', agent: undefined, work: work('/Users/sam/dev/mobile-app', 'mobile-app') }),
  task('EV-15', 'Old export script', '', 'done', { doneAt: NOW - 3 * day, work: work('/Users/sam/dev/exports', 'exports') }),
]

const sched = (id: string, name: string, pl: string, when: string, nextWords: string, last: string, what: string, x: Partial<Automation> = {}): Automation => ({ id, name, place: pl, when, what, on: true, next: [], nextWords, last, ...x })
export const automations: Record<string, Automation[]> = {
  [EV]: [sched('EV-S1', 'Morning brief', EV, 'Every day 7:30', 'tomorrow 7:30', 'today 7:30 · 3 ready, 1 question', 'Tell me what needs me today.'), sched('EV-S2', 'Renew the domain', EV, 'Once · Fri 27 Nov 9:00', '', '', "Remind me to renew the shop's domain.", { once: true })],
  [P.shop]: [
    sched('SHOP-S2', 'Update the changelog', P.shop, 'When a task is merged', '', 'last week, after Fix cart rounding merged', 'Add the merged task to the changelog.'),
    sched('SHOP-S3', 'Look for stuck work', P.shop, 'Every 30 minutes', 'in 12 min', '10:30 · nothing to do', 'Look over #shop. If something is stuck or failing, deal with it or tell me.', { runs: [{ at: NOW - 18 * min, task: 'SHOP-10' }, { at: NOW - 48 * min, task: 'SHOP-9' }] }),
    sched('SHOP-S1', 'Dependency check', P.shop, 'Mondays 9:00', 'in 7 days', 'today 9:00 · 3 packages behind, updating', 'Check for outdated packages and tell me what you find.', { runs: [{ at: today(9), task: 'SHOP-16' }] }),
  ],
  [P.blog]: [sched('BLOG-S1', 'Broken link check', P.blog, 'Every night 2:00', 'in 9h', 'last night 2:00 · 1 link fixed', 'Check every link on the site and fix the broken ones.', { runs: [{ at: today(2), task: 'BLOG-6' }] })],
}

const art = (id: string, title: string, pl: string, at: number, x: Record<string, unknown> = {}) => ({ id, title, place: pl, v: 3, at, when: '', by: '', keeper: '', versions: [{ n: 3, at, when: '', by: '', html: 1 }, { n: 2, at: at - 4 * day, when: '', by: '', html: 1 }, { n: 1, at: at - 7 * day, when: '', by: '', html: 1 }], thumb: true, ...x })
export const artifacts = [
  art('a-quotes', 'Supplier quotes compared', P.notes, NOW - 3 * hour, { task: 'NOTES-4', proof: true }),
  art('a-plan', 'Holiday sale plan', P.shop, NOW - 2 * day),
  art('a-mock', 'Checkout mock-up', P.shop, NOW - 2 * day),
  art('a-deck', 'Launch deck', P.blog, NOW - 7 * day),
  art('a-csv', 'Sales 2026', P.notes, NOW - 14 * day),
  art('a-picks', 'Garden chair picks', P.shop, NOW - 5 * hour),
  art('a-shop12', 'Faster product search · Proof', P.shop, NOW - 8 * hour, { task: 'SHOP-12', proof: true }),
] as Snapshot['artifacts']

const cc = (model: string, effort: string) => ({ agent: 'claude', model, effort, fast: false as const, perm: null })
// the workers below run Opus fast: the usual Tasks setting says so too, so a row leaves its model out (dmalis/shepherdr#100)
const ccf = (model: string, effort: string) => ({ ...cc(model, effort), fast: true as const })
export const config: Config = {
  all: { agents: { Chats: cc('sonnet', 'medium'), Tasks: ccf('opus', 'high'), Reviews: { agent: 'codex', model: 'gpt-6.2-sol', effort: 'high', fast: false, perm: null } }, review: false, merge: 'done', proof: true },
  spaces: { [P.shop]: { agents: { Chats: cc('fable', 'high'), Tasks: ccf('opus', 'high'), Reviews: { agent: 'codex', model: 'gpt-6.2-sol', effort: 'high', fast: false, perm: null } }, review: false, merge: 'done', proof: true, own: ['agents.Chats'] },
    // fork Needs you 3/6: a space with its alerts muted (its menu says Unmute alerts)
    [P.notes]: { agents: { Chats: cc('sonnet', 'medium'), Tasks: ccf('opus', 'high'), Reviews: { agent: 'codex', model: 'gpt-6.2-sol', effort: 'high', fast: false, perm: null } }, review: false, merge: 'done', proof: true, alerts: 'Muted', own: ['alerts'] } },
  // SHEP-335: task settings are the repo's a task works in; root on vm sits on /, its tasks work in the acme shop
  repos: [
    { key: '/Users/sam/dev/shop', folder: '/Users/sam/dev/shop', machine: null, name: 'shop', spaces: [P.shop], tasks: 6, agents: { Chats: cc('sonnet', 'medium'), Tasks: cc('opus', 'xhigh'), Reviews: { agent: 'codex', model: 'gpt-6.2-sol', effort: 'high', fast: false, perm: null } }, review: true, merge: 'checks', proof: true, rounds: 2, mustFix: 'blocker', own: ['agents.Tasks', 'review', 'merge', 'must_fix'] },
    { key: 'vm:/home/sam/clients/acme/shop', folder: '/home/sam/clients/acme/shop', machine: 'vm', name: 'shop', spaces: [P.vmShop], tasks: 1, agents: { Chats: cc('sonnet', 'medium'), Tasks: ccf('opus', 'high'), Reviews: { agent: 'codex', model: 'gpt-6.2-sol', effort: 'high', fast: false, perm: null } }, review: false, merge: 'now', proof: true, own: ['merge'] },
    { key: 'vm:/home/sam/dev/garden-app', folder: '/home/sam/dev/garden-app', machine: 'vm', name: 'garden-app', spaces: [P.garden], tasks: 2, agents: { Chats: cc('sonnet', 'medium'), Tasks: ccf('opus', 'high'), Reviews: { agent: 'codex', model: 'gpt-6.2-sol', effort: 'high', fast: false, perm: null } }, review: false, merge: 'done', proof: true, own: [] },
    { key: '/Users/sam/dev/blog', folder: '/Users/sam/dev/blog', machine: null, name: 'blog', spaces: [P.blog], tasks: 1, agents: { Chats: cc('sonnet', 'medium'), Tasks: ccf('opus', 'high'), Reviews: { agent: 'codex', model: 'gpt-6.2-sol', effort: 'high', fast: false, perm: null } }, review: false, merge: 'done', proof: true, own: [] },
    { key: '/Users/sam/notes', folder: '/Users/sam/notes', machine: null, name: 'notes', spaces: [P.notes], tasks: 1, agents: { Chats: cc('sonnet', 'medium'), Tasks: ccf('opus', 'high'), Reviews: { agent: 'codex', model: 'gpt-6.2-sol', effort: 'high', fast: false, perm: null } }, review: false, merge: 'done', proof: false, own: ['proof'] },
    { key: 'vm:/', folder: '/', machine: 'vm', name: '/', spaces: [P.vmRoot], tasks: 0, agents: { Chats: cc('sonnet', 'medium'), Tasks: ccf('opus', 'high'), Reviews: { agent: 'codex', model: 'gpt-6.2-sol', effort: 'high', fast: false, perm: null } }, review: false, merge: 'done', proof: true, own: [] },
  ],
  secrets: [{ name: 'GITHUB_TOKEN', scope: 'all' }, { name: 'STRIPE_KEY', scope: P.shop }],
  plugins: [['tasks', 'Tasks', true], ['artifacts', 'Artifacts', true], ['terminal', 'Terminal', false], ['screens', 'Screens', false], ['voice', 'Voice', false], ['schedules', 'Schedules', false], ['reactions', 'Reactions', false], ['search', 'Search', true], ['alerts', 'Alerts', true]].map(([id, name, always]) => ({ id: id as string, name: name as string, on: true, ...(always ? { always: true } : {}) })),
  plans: [{ name: 'ElevenLabs Creator', windows: [{ name: 'Characters', used: 76, resets: 'Resets Monday 9:00' }] }],
  addMachine: 'hc machine add <name>',
  desktops: ['mac-mini'],
}

// what machine.py sends for each agent CLI it finds: where to see its plan usage, never a read
const noUsage: MachineLimits = {
  claude: { state: 'no-access', why: "Shepherdr doesn't read Claude plan usage. Open Claude Code and run /usage.", at: NOW },
  codex: { state: 'no-access', why: "Shepherdr doesn't read Codex plan usage. Open Codex and run /status.", at: NOW },
}

const R1 = ['regular']
const m =(id: string, name: string, speeds = R1, group?: string) => ({ id, name, speeds, ...(group ? { group } : {}) })
export const catalog = (machine: string): Catalog => ({
  machine,
  agents: [
    { id: 'claude', name: 'Claude Code', installed: true, models: [m('fable', 'Fable 5.2', ['regular', 'fast']), m('opus', 'Opus 5.5', ['regular', 'fast']), m('opus1m', 'Opus 5.5 · 1M', ['regular', 'fast']), m('sonnet', 'Sonnet 5.5'), m('haiku', 'Haiku 5.5')], efforts: ['low', 'medium', 'high', 'xhigh', 'max'], perms: [{ id: 'default', label: 'Default', about: 'Asks before edits and commands' }, { id: 'acceptEdits', label: 'Accept edits', about: 'Edits files without asking' }, { id: 'plan', label: 'Plan', about: 'Plans first and changes nothing' }, { id: 'auto', label: 'Auto', about: 'Decides by itself what is safe to run' }, { id: 'bypass', label: 'Bypass', about: 'Never asks' }], permDefault: 'default', defaultModel: 'sonnet', defaultEffort: 'medium' },
    { id: 'codex', name: 'Codex', installed: true, models: [m('gpt-6.2-sol', 'GPT-6.2 Sol', ['regular', 'fast', 'ultrafast']), m('gpt-5.5', 'GPT-5.5', ['regular', 'fast']), m('gpt-5.5-mini', 'GPT-5.5 mini')], efforts: ['low', 'medium', 'high', 'xhigh'], perms: [{ id: 'read-only', label: 'Read only', about: 'Reads, and asks before anything else' }, { id: 'auto', label: 'Auto', about: 'Can edit the workspace. Uses Shepherdr’s setting to ask when it needs more access.' }, { id: 'approve', label: 'Approve for me', about: 'Its own review allows safe steps, asks you about risky ones' }, { id: 'full', label: 'Full access', about: 'Runs outside the sandbox without asking. Matches danger-full-access with approvals off.' }], permDefault: 'auto', defaultModel: 'gpt-6.2-sol', defaultEffort: 'high' },
    { id: 'opencode', name: 'OpenCode', installed: true, models: [...['Fable 5.2', 'Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5'].map((n) => m(`a-${n}`, n, R1, 'Anthropic')), ...['GPT-5.5', 'GPT-6.2 Sol', 'GPT-5.5 mini'].map((n) => m(`o-${n}`, n, R1, 'OpenAI')), ...['Gemini 3 Pro', 'Gemini 3 Flash'].map((n) => m(`g-${n}`, n, R1, 'Google')), ...['Grok 5', 'Grok 5 Fast'].map((n) => m(`x-${n}`, n, R1, 'xAI')), ...['DeepSeek V4', 'Kimi K3', 'Qwen 4 Coder', 'GLM 5', 'Mistral Large 3'].map((n) => m(`r-${n}`, n, R1, 'OpenRouter')), ...['Qwen Coder 32B', 'Llama 5 70B'].map((n) => m(`l-${n}`, n, R1, 'On this machine'))], efforts: [], perms: [{ id: 'ask', label: 'Ask', about: 'Asks before edits and commands' }, { id: 'all', label: 'Allow all', about: 'Never asks' }], permDefault: 'ask' },
    { id: 'pi', name: 'Pi', installed: true, models: [m('p-s', 'Sonnet 5.5', R1, 'Anthropic'), m('p-o', 'Opus 5.5', R1, 'Anthropic'), m('p-g', 'GPT-5.5', R1, 'OpenAI'), m('p-ge', 'Gemini 3 Pro', R1, 'Google')], efforts: ['low', 'medium', 'high'], perms: [] },
    ...['Aider', 'Amp', 'Cline', 'Copilot CLI', 'Crush', 'Cursor Agent', 'Droid', 'Gemini CLI', 'goose', 'Grok Build', 'Kilo Code', 'Kiro', 'Qwen Code'].map((name) => ({ id: name.toLowerCase().replace(/\s+/g, '-'), name, installed: false, models: [], efforts: [], perms: [] })),
  ],
})

// ?case=long: long names everywhere, for checking text gets its room and is cut only where the space ends
const LONG_NAMES: Record<string, string> = {
  'SHOP-15': 'Bigger checkout button on phones, and the same for the cart page and the one-page checkout',
  'SHOP-12': 'Faster product search: results as you type, with typo tolerance and the top sellers first',
  'BLOG-9': 'Dark mode for code blocks, matching the theme the reader picked in their system settings',
}
// Settings › Secrets with fifteen made-up ones, in no order, long and short, every level (fork: Secrets: no overlap)
const v = (name: string, scope: 'everywhere' | 'machine' | 'space', at: string | null = null) => ({ name, at: NOW - 3 * day, scope, machine: scope === 'machine' ? at : null, space: scope === 'space' ? at : null, where: '' })
const LONG_SECRETS = [
  v('ACME_PAYMENTS_WEBHOOK_SECRET', 'everywhere'), v('GITHUB_TOKEN', 'everywhere'), v('SENTRY_AUTH_TOKEN', 'machine', 'vm'), v('OPENWEATHER_API_KEY', 'everywhere'),
  v('DEPLOY_KEY', 'machine', 'vm'), v('STRIPE_KEY', 'space', P.shop), v('SHOP_STOREFRONT_PREVIEW_DEPLOY_HOOK_URL', 'space', P.shop), v('NPM_TOKEN', 'everywhere'),
  v('POSTGRES_PASSWORD', 'machine'), v('CLOUDFLARE_R2_SECRET_ACCESS_KEY', 'everywhere'), v('MAILER_SMTP_PASSWORD', 'space', P.blog), v('S3_BUCKET_UPLOAD_SIGNING_SECRET', 'machine', 'vm'),
  v('GITHUB_TOKEN', 'space', P.shop), v('GOOGLE_MAPS_BROWSER_KEY', 'everywhere'), v('RELEASENOTESBOTTOKENFORTHECHANGELOG', 'everywhere'),
]
const longDay = (s: Snapshot): Snapshot => ({
  ...s,
  settings: s.settings?.map((x) => (x.name === 'Secrets' ? { ...x, vault: LONG_SECRETS } : x)),
  places: s.places.map((p) => (p.id === P.shop ? { ...p, name: 'shop-storefront-and-checkout' } : p)),
  tasks: s.tasks.map((t) => ({ ...t, ...(LONG_NAMES[t.id] ? { name: LONG_NAMES[t.id] } : {}), ...(t.id === 'BLOG-9' ? { afterTitle: LONG_NAMES['SHOP-12'], afterMore: 5 } : {}) })),
  artifacts: s.artifacts.map((a: any, i: number) => (i === 0 ? { ...a, title: `${a.title}: the whole story, with every screenshot and the numbers behind it` } : a)),
})

// ?case=one and ?case=five (SHEP-438): the sidebar with one machine only, and with a fifth one to fold and drag
const pcts = (lo: number, hi: number, by: number) => Array.from({ length: (hi - lo) / by + 1 }, (_, i) => `${lo + i * by}%`)
const LIMIT_DEMO: [string, string, string[]][] = [['start_memory', '80%', pcts(10, 100, 5)], ['start_load', '100%', pcts(25, 400, 25)], ['start_disk', '90%', pcts(10, 100, 5)]]
/** a machine's start-limit rows as the service gives them (machine.<field>@<machine>); own: the ones it set itself */
const limitRows = (at: string, own: Record<string, string>) => LIMIT_DEMO.map(([f, d, steps]) => ({ label: f, key: `machine.${f}@${at}`, value: own[f] ?? d, steps, stepFrom: d, group: at, ...(f in own ? { inherits: { value: d, from: 'all machines' } } : { from: 'all machines' }) }))
const oneMachine = (s: Snapshot): Snapshot => ({ ...s, machines: s.machines.slice(0, 1), places: s.places.filter((p) => p.machine === s.host), warnings: [] })
const fiveMachines = (s: Snapshot): Snapshot => ({
  ...s,
  machines: [...s.machines, { id: 'm:laptop', machine: 'laptop', name: 'laptop', status: 'idle' }],
  places: [...s.places, { ...s.places.find((p) => p.machine === 'pi')!, id: 'p:laptop:home', chat: 'p:laptop:home', machine: 'laptop' }, { ...s.places.find((p) => p.machine === 'studio' && !p.home)!, id: 'p:laptop:notes', chat: 'p:laptop:notes', machine: 'laptop', name: 'notes' }],
})

export function snapshot(mode: 'normal' | 'empty' | 'down' | 'more' | 'long' | 'one' | 'five' = 'normal'): Snapshot {
  if (mode === 'long') return longDay(snapshot('normal'))
  if (mode === 'one') return oneMachine(snapshot('normal'))
  if (mode === 'five') return fiveMachines(snapshot('normal'))
  const empty = mode === 'empty'
  const down = mode === 'down'
  return {
    demo: true,
    terminalTransport: 'core',
    name: 'Shepherdr',
    host: 'mac-mini',
    user: 'Sam',
    everything: EV,
    // two spaces called shop, in other folders on other machines, and one deep folder (SHEP-302); a space at the root (SHEP-316)
    places: [place(EV, 'home', 'mac-mini', at('/Users/sam', '~', { home: true })), place(P.shop, 'shop', 'mac-mini', at('/Users/sam/dev/shop', undefined, { git: 'main' })), place(P.blog, 'blog', 'mac-mini', at('/Users/sam/dev/blog')), place(P.notes, 'notes', 'mac-mini', at('/Users/sam/notes', undefined, { emoji: '📝' })), place(P.docs, 'docs', 'mac-mini', at('/Users/sam/dev/clients/northwind/website-redesign-2026/docs')), place(P.garden, 'garden-app', 'vm', at('/home/sam/dev/garden-app')), place(P.vmShop, 'shop', 'vm', at('/home/sam/clients/acme/shop')), place(P.vmRoot, 'root', 'vm', at('/')),
      // SHEP-342: an archived space for the machines' filter, a machine with one space and one with none
      place(P.oldSite, 'old-site', 'mac-mini', at('/Users/sam/dev/old-site', undefined, { archived: true })), place(P.studioSite, 'site', 'studio', at('/Users/sam/dev/site')),
      // SHEP-354: a space with a long name, for the Tasks filter's width
      place(P.vmPortal, 'customer-portal-and-billing-redesign', 'vm', at('/home/sam/clients/northwind/portal')),
      // SHEP-429: every other machine's home space, its first row as ~; pi has nothing else
      place('p:mac-mini:tilde', 'home', 'mac-mini', at('/Users/sam', '~', { home: true, unnamed: true })), place('p:vm:home', 'home', 'vm', at('/home/sam', '~', { home: true, unnamed: true })), place('p:studio:home', 'home', 'studio', at('/Users/sam', '~', { home: true, unnamed: true })), place('p:pi:home', 'home', 'pi', at('/home/sam', '~', { home: true, unnamed: true }))],
    // two groups and spaces in no group on one machine (fork patch #31: a loose space can be dragged above or between them)
    sections: [{ id: 's:store', name: 'Store', machine: 'mac-mini', spaces: [P.shop, P.blog] }, { id: 's:writing', name: 'Writing', machine: 'mac-mini', spaces: [P.docs] }],
    // #1560: blog's and garden-app's Assistants said something you haven't read: their rows are bold until opened
    last: empty ? {} : { [P.blog]: 3, [P.garden]: 2, [P.shop]: 5, [P.vmRoot]: 2 },
    read: empty ? {} : { [P.blog]: 2, [P.garden]: 1, [P.shop]: 5, [P.vmRoot]: 1 },
    machines: [
      { id: 'm:mac-mini', machine: 'mac-mini', name: 'mac-mini', status: 'idle', here: true, limits: noUsage, ...facts['mac-mini'], health: { meters: [{ name: 'CPU', pct: 34, detail: '', level: 'ok' }, { name: 'Memory', pct: 71, detail: '', level: 'ok' }, { name: 'Disk', pct: 58, detail: '', level: 'ok' }], herdr: true, working: 5, held: 0, at: '' } },
      { id: 'm:vm', machine: 'vm', name: 'vm', status: down ? 'off' : 'idle', ...(down ? { unreachableSince: '14:02' } : {}), limits: noUsage, ...facts.vm, health: { meters: [{ name: 'CPU', pct: 12, detail: '', level: 'ok' }, { name: 'Memory', pct: 40, detail: '', level: 'ok' }, { name: 'Disk', pct: empty ? 40 : 91, detail: '', level: 'over' }], herdr: true, working: 2, held: 0, at: '' } },
      { id: 'm:studio', machine: 'studio', name: 'studio', status: 'idle', ...facts.studio, health: { meters: [{ name: 'CPU', pct: 18, detail: '', level: 'ok' }, { name: 'Memory', pct: 44, detail: '', level: 'ok' }, { name: 'Disk', pct: 4, detail: '', level: 'ok' }], herdr: true, working: 1, held: 0, at: '' } },
      // #107: pi can't be reached (Settings › Machines shows one of each: fine, needs attention, can't reach)
      { id: 'm:pi', machine: 'pi', name: 'pi', status: 'off', unreachableSince: 'Tue 9:12' },
    ],
    tasks: empty ? [] : tasks.map((t) => {
      const settings = t.agent && chats[t.agent.chat]?.agent
      return t.agent && settings ? { ...t, agent: { ...t.agent, settings } } : t
    }),
    automations: empty ? {} : automations,
    artifacts: empty ? [] : artifacts,
    asks: {},
    // what waits on you with a card, as the service lists it (Needs you 1/6: a tap on a count scrolls to its card)
    needs: empty ? [] : [
      { id: 'q-docs', chat: 'DOCS-3/worker', place: P.docs, task: 'DOCS-3', at: NOW - 4 * min, question: docsQ().at(-1)!.question! },
      { id: 'q-spam', chat: 'studio:SITE-5/worker', place: P.studioSite, task: 'studio:SITE-5', at: NOW - 7 * min, question: spamQ().at(-1)!.question! },
      { id: 'q-labels', chat: 'vm:ACME-10/worker', place: P.vmShop, task: 'vm:ACME-10', at: NOW - 2 * min, question: labelsQ().at(-1)!.question! },
    ],
    // #1547: each machine's start limits, as the service's Machines section keeps them
    settings: [{ name: 'Machines', rows: limitRows('local', {}).concat(limitRows('vm', { start_memory: '70%', start_disk: 'Off' }), limitRows('studio', {})) },
      // Settings › Secrets: every kept secret by name and where, a machine's own too (#1560)
      { name: 'Secrets', level: 'all', rows: [], vault: [
        { name: 'GITHUB_TOKEN', at: NOW - 9 * day, scope: 'everywhere', machine: null, space: null, where: 'Everywhere' },
        { name: 'DEPLOY_KEY', at: NOW - 3 * day, scope: 'machine', machine: 'vm', space: null, where: 'vm' },
        { name: 'STRIPE_KEY', at: NOW - 2 * day, scope: 'space', machine: null, space: P.shop, where: 'Space shop' },
      ] }],
    config,
    // the bell's list (fork #37): what the push alerts said this week, some read, some still waiting
    inbox: empty ? [] : inbox,
    feedback: empty ? { rows: [], found: 0, off: false } : feedback,
    warnings: empty ? [] : down ? [{ id: 'm:vm', kind: 'machine', text: "Can't reach vm · last seen 14:02" }] : [{ id: 'u:elevenlabs', kind: 'usage', text: "You've used 76% of your ElevenLabs plan" }, { id: 'm:vm', kind: 'machine', text: 'vm: disk nearly full' }, ...(mode === 'more' ? [{ id: 'm:mini', kind: 'machine' as const, text: 'mac-mini: memory nearly full' }] : [])],
    screens: empty ? {} : {
      'task:SHOP-17': { b: { url: 'https://billing.example.com/login' }, d: { of: 'mac-mini', own: false, busy: 'Bigger checkout button on phones' }, active: true, driver: 'agent', hands: { what: 'Enter the sign-in code' } },
      'task:SHOP-15': { b: { url: 'http://localhost:3000/checkout' }, d: { of: 'mac-mini', own: false }, active: true, driver: 'agent' },
      'task:vm:GARDEN-3': { d: { of: 'vm', own: true }, active: true, driver: 'agent' },
      'machine:mac-mini': { d: { of: 'mac-mini', own: false, busy: 'Bigger checkout button on phones' } },
    },
    off: [],
  }
}

let n = 0
const a = (text: string, x: Partial<Message> = {}): Message => ({ id: `m${++n}`, who: 'agent', text, ...x })
const me = (text: string, x: Partial<Message> = {}): Message => ({ id: `m${++n}`, who: 'you', text, ...x })
const did = (at: number, rows: [string, string, string][], summary?: string): Message => ({ id: `m${++n}`, who: 'agent', activity: { id: `a${n}`, at, end: at + 1000, steps: rows.length, ...(summary ? { summary } : {}), rows: rows.map(([kind, text, x], i) => ({ key: `${n}:${i}`, kind: kind as 'run', text, steps: ['s'], ...(x.startsWith('+') ? { added: Number(x.slice(1).split(' ')[0]), removed: Number((x.split('−')[1] ?? '0')) || undefined } : {}) })) } })
const ask = (id: string, title: string, by: { ref: string; title: string; chat: string } | undefined, choices: string[], x: Record<string, unknown> = {}): Message => ({ id: `ask:${id}`, who: 'agent', question: { id, title, kind: 'Question', choices: choices.map((label) => ({ label })), to: '', ...(by ? { by } : {}), ...x } })

// a task's brief, its chat's first message (SHEP-330): what the shop's Assistant wrote, its Settings folded away
const SETTINGS = ['Review: off', 'Merge: after checks', 'Proof: before and after screenshots', 'Agent: claude, model opus, effort high']
const brief = (title: string, text: string, state: 'waiting' | 'sent' | 'read', at?: number): Message => ({ id: `m${++n}`, who: 'you', text, ...(at ? { at } : {}), taskBrief: { title, text, settings: SETTINGS, from: 'Assistant', state } })
const LONG_BRIEF = [
  "On phones the checkout button is small and sits right under the total, so people tap the total instead. Make it easy to hit.",
  '',
  "Sam's words: \"On my phone I keep missing the pay button. Make it big, the whole width, like other shops do.\"",
  '',
  'Do:',
  '- On screens under 640 px wide, the checkout button spans the full width, 48 px tall, with 16 px around it.',
  '- Keep it where it is on larger screens.',
  '- The button keeps its colour and its words ("Pay now").',
  '- Check the cart page and the one-page checkout; both use the same button.',
  '- Tests: the button is full width at 390 px and unchanged at 1280 px.',
  '- Proof: before and after screenshots on a phone and a laptop.',
  '',
  'Stay inside this change. Do not touch the payment code.',
].join('\n')

const byPay = { ref: 'SHOP-14', title: 'Switch payment provider', chat: 'SHOP-14/worker' }
const byPhoto = { ref: 'GARDEN-4', title: 'Photo upload', chat: 'vm:GARDEN-4/worker' }
/** a message between agents (SHEP-368): one quiet row, in the sender's chat ("to") and the receiver's ("from") */
const relay = (dir: 'to' | 'from', name: string, text: string, at: number, x: Partial<NonNullable<Message['relay']>> = {}): Message =>
  ({ id: `m${++n}`, who: dir === 'to' ? 'agent' : 'you', text, at, brief: { label: `Message ${dir} ${name}` }, relay: { dir, name, ...x } })
const LONG_NOTE = 'The supplier quotes are in. Short version: the second supplier is cheapest per unit but ships in six weeks; the first ships in one.\n\n' +
  'Before the checkout change merges, can you check whether the bigger button still fits the order summary on the smallest phones? The last change pushed the total below the fold on a 360 px screen, and people missed it.\n\n' +
  'Nothing else needs you today. I will tell you here when the quotes task is ready.'
const chat = (key: string, messages: Message[], agent: Chat['agent'], x: Partial<Chat> = {}): Chat => ({ key, messages, cli: agent?.kind ?? 'claude', top: true, agent, ...x })
const sonnet = { kind: 'claude', model: 'sonnet', modelLabel: 'Sonnet 5.5', effort: 'medium' }
const opus = { kind: 'claude', model: 'opus', modelLabel: 'Opus 5.5', effort: 'high', speed: 'fast' }
// a newer Codex is out: the chat shows Update Codex (plugins/chat/update.tsx)
const gpt = { kind: 'codex', model: 'gpt-6.2-sol', modelLabel: 'GPT-6.2 Sol', effort: 'xhigh', speed: 'ultrafast', update: '0.172.0' }
const payQ = () => [a("Which provider should I switch to, Stripe or Adyen? I'd go with Stripe."), ask('q-pay', '', undefined, ['Stripe', 'Adyen'])]
const docsQ = () => [a('The install steps are rewritten for the new installer. Which install command should the guide show first?'), ask('q-docs', '', undefined, ['The one-line script', 'Homebrew'])]
const spamQ = () => [a('The filter needs a library that scores messages for spam.'), ask('q-spam', 'Run a command', undefined, ['Allow once', 'Decline'], { command: 'npm install spamscore' })]
const labelsQ = () => [a('Printing needs the label script to reach the printer.'), ask('q-labels', 'Run a command', undefined, ['Allow once', 'Decline'], { command: 'npm run labels:print' })]
const permQ = (by?: typeof byPhoto) => [a('I need an image library to resize the photos.'), ask('q-pil', 'Run a command', by, ['Allow once', 'Decline'], { command: 'pip install pillow' })]

export const chats: Record<string, Chat> = Object.fromEntries(
  [
    chat(EV, [
      a('Morning, Sam. Watering reminders is still in progress. Three things are ready for you:', { at: today(7, 30), suggests: ['Show me what needs me'] }),
      me('', { at: today(9, 11), file: { name: 'supplier-quotes-november.pdf', path: '/demo/supplier-quotes-november.pdf' } }),
      // #56: a picture you sent while it worked (one only in the agent's log), as itself; a tap opens it full size
      me('The checkout on my phone, the button is tiny', { at: today(9, 11) }),
      me('', { at: today(9, 11), file: { name: 'Image.png', path: '/demo/sent-checkout.jpg', alt: 'Image' } }),
      me('Nice. Add a task to make the checkout button bigger on phones.', { at: today(9, 12), reactions: [{ emoji: '👀', by: 'them' }] }),
      a('Added Bigger checkout button on phones to #shop and started it.', { at: today(9, 12), reactions: [{ emoji: '🎉', by: 'me' }] }),
      did(today(9, 12), [['run', 'herdr-task add', '"Bigger checkout button on phones"'], ['run', 'herdr-task start', '"Bigger checkout button on phones"']]),
      a("I'll tell you here when it's ready.", { at: today(9, 13), reactions: [{ emoji: '👍', by: 'me' }] }),
      // a heads-up its CLI wrote, and a recap when you came back (Recaps)
      { id: `m${++n}`, who: 'agent', at: today(9, 13), recap: 'heads', text: 'Compacted while idle, before the prompt cache expired' },
      { id: `m${++n}`, who: 'agent', at: today(9, 13), recap: 'recap', text: 'The bigger checkout button is being built in #shop and the watering reminders are still in progress. Two tasks wait on you: pick Stripe or Adyen, and allow the photo library.' },
      relay('to', '#root on vm', 'Can you check the disk on the vm? A task there said it is nearly full.', today(9, 14), { how: 'assistant', state: 'delivered' }),
      // "Chat: say what each thing is": a schedule's run whose title reads like news, its news row, a picked mention and the agent's link to it
      { id: `m${++n}`, who: 'agent', at: today(9, 15), news: { task: 'EV-21', ref: 'EV-21', mark: 'other', what: 'installed', text: 'the newest main is live; its health check passed.' } },
      me('What did [@Install merged](task:EV-21) put on?', { at: today(9, 16) }),
      a('[@Install merged](task:EV-21) installed the newest main: the merged Trust card tip is live.', { at: today(9, 16) }),
      me('Did it check the payment one too?', { at: today(9, 17), reply: { text: 'Install merged', task: 'EV-21' } }),
      relay('from', '#shop', LONG_NOTE, today(9, 20), { files: ['supplier-quotes-november.pdf'] }),
      relay('to', '#garden-app on vm', 'The photo task waits on a library. Pillow is fine to install.', today(9, 22), { how: 'assistant', state: 'waiting', why: 'the person is writing to it' }),
      relay('to', 'Assistant on studio', 'Is the site build green again?', today(9, 23), { how: 'assistant', state: 'failed', why: "studio can't be reached" }),
      // dmalis/shepherdr#114: a wait the Assistant handles is the quiet grey tier; only a question card or a permission says Needs you
      { id: `m${++n}`, who: 'agent', news: { task: 'EV-13', ref: 'EV-13', event: 'waiting', needs: 'reply', mark: 'needs', what: 'waiting', text: 'Should locked levels show?' } },
      { id: `m${++n}`, who: 'agent', news: { task: 'SHOP-14', ref: 'SHOP-14', event: 'needs-you', needs: 'asks', mark: 'needs', what: 'needs the person', text: "Which provider should I switch to, Stripe or Adyen? I'd go with Stripe." } },
      ask('q-pay', '', byPay, ['Stripe', 'Adyen'], { other: true }),
      { id: `m${++n}`, who: 'agent', news: { task: 'vm:GARDEN-4', ref: 'GARDEN-4', event: 'needs-you', needs: 'asks', mark: 'needs', what: 'needs the person', text: 'I need an image library to resize the photos.' } },
      ask('q-pil', 'Run a command', byPhoto, ['Allow once', 'Decline'], { command: 'pip install pillow' }),
      // a working task's row with its time left, then how its asks closed: the same line twice shows once
      { id: `m${++n}`, who: 'agent', news: { task: 'SHOP-15', ref: 'SHOP-15', mark: 'other', what: 'blocked', text: 'Waiting at a prompt' } },
      { id: `m${++n}`, who: 'agent', ended: 'Task · Bigger checkout button on phones · Run: npm test · Allowed in the chat' },
      { id: `m${++n}`, who: 'agent', ended: 'Task · Bigger checkout button on phones · Run: npm test · Allowed in the chat' },
      a('Dependency check started on its schedule in #shop. It found 3 packages behind and is updating them.', { id: 'm-dep' }),
      me('And the sale plan, APP/?artifact=a-plan, still good?'),
      // #1560: pictures the chat can't show here, and an artifact on its way
      a('', { images: 3 }),
      // #56: a picture still in its CLI's queue: no picture there yet, and the line says when it shows
      me('And this one', { waiting: true, waitsFor: 'queue' }),
      me('', { images: 1, waiting: true, waitsFor: 'queue' }),
      a('', { publishing: true }),
      // a reply that quotes a long message, with a short answer: the quote truncates inside the bubble (SHEP-353)
      me('Use /ui to fix', { reply: { id: 'm-dep', text: 'Dependency check started on its schedule in #shop. It found 3 packages behind and is updating them. Supercalifragilisticexpialidociouslylongwordwithoutanybreaks', who: 'agent' }, reactions: [{ emoji: '👍', by: 'them' }] }),
      me('Pinned to https://example.com/releases/2026/november/checkout-redesign-final-final-v2-with-the-bigger-button and Pneumonoultramicroscopicsilicovolcanoconiosis too', { reactions: [{ emoji: '🎉', by: 'both' }] }),
      a('Noted: https://example.com/releases/2026/november/checkout-redesign-final-final-v2-with-the-bigger-button is the one, and Pneumonoultramicroscopicsilicovolcanoconiosis stays.', { reactions: [{ emoji: '👍', by: 'me' }] }),
      // a wide table (#1442): readable columns that scroll sideways in their box on a phone, never one letter wide
      a('The broken links I found:\n\n| # | Page | Old link | New link | Status | Redirect | Last edited | Owner | Next step |\n|---|---|---|---|---|---|---|---|---|\n| 1 | November recipes roundup | `/2025/11/recipes` | `/archive/2025/november-recipes` | Broken (404) | Missing | 3 weeks ago | Sam | Add a permanent redirect and update the sidebar link |\n| 2 | Shop | `/shop/old` | `/shop` | Moved | 301 | today | Alex | None |'),
      // links to the app itself, as `herdr-artifact link` prints them: they open in the app (SHEP-339)
      a('The quotes are compared: [Supplier quotes compared](APP/?artifact=a-quotes). Its task: [Compare supplier quotes](APP/?task=NOTES-4). The [shop space](APP/?place=p:mac-mini:shop). The suppliers\' own site: [example.com](https://example.com/), the sheet: [`quotes/compare.csv`](https://example.com/compare.csv).', { suggests: ['Show me what needs me', 'Start the Adyen paperwork anyway, just in case', 'status?'] }),
    ], sonnet),
    chat(P.shop, [relay('from', 'Everything', LONG_NOTE, today(9, 20) - 2 * min), relay('to', 'Everything', LONG_NOTE, today(9, 20), { how: 'assistant', state: 'delivered' }),
      relay('to', 'Bigger checkout button on phones', 'Keep the total above the fold on a 360 px screen too.', today(9, 25), { how: 'reply', state: 'delivered' }),
      relay('from', 'Bigger checkout button on phones', 'Done: the total stays above the fold at 360 px. Screenshot in my chat.', today(9, 40)),
      relay('to', 'Faster product search', 'Fix what keeps its pull request from merging.', today(9, 41), { how: 'fix', state: 'waiting', why: 'its agent stopped; it goes to its next one' }),
      a('I made a mock-up of the new checkout. Have a look.'), { id: `m${++n}`, who: 'agent', artifact: { id: 'a-mock', v: 2 } }, a('Started SHOP-15, added from Everything.'), { id: `m${++n}`, who: 'agent', news: { task: 'SHOP-14', ref: 'SHOP-14', event: 'needs-you', needs: 'asks', mark: 'needs', what: 'needs the person', text: "Which provider should I switch to, Stripe or Adyen? I'd go with Stripe." } }, ask('q-pay', '', byPay, ['Stripe', 'Adyen']), a('SHOP-16 started on its schedule in #shop. It found 3 packages behind and is updating them.', { suggest: 'How is the checkout button going?' })], sonnet),
    // working, nothing written yet: the working sign alone (SHEP-313)
    chat(P.blog, [a('To see it yourself, run this in the blog folder:\n\n```\nbun run dev\n```'), me('!git status --short', { command: { state: 'done', out: ' M web/src/archive.ts\n?? drafts/november.md' } }), me('!bun test archive', { command: { state: 'failed', out: 'archive.test.ts:\n✗ links to every month [4.21ms]\n  Expected: "/archive/2026/11"\n  Received: "/archive/undefined"\n\n 0 pass\n 1 fail' } }), me('The link to the archive is broken too. Can you fix it?', { reactions: [{ emoji: '👍', by: 'both' }] })], sonnet, { working: true, doing: "Running python3 - <<'EOF' p='web/src/archive.ts'" }),
    chat(P.notes, [], sonnet),
    // dmalis/shepherdr#51: bubbles that point at a list a few messages up show which message they answer, and a tapped
    // one goes as a reply to it
    chat(P.docs, [
      a("Here's what I'd change in the docs:\n\n1. Add the Everything hint to Getting started\n2. Shorten the install page\n3. Fix the broken links in the FAQ\n4. Rewrite the Settings page\n\nThe first three are quick. The fourth is a bigger job.", { at: today(10, 2) }),
      me('What would the Everything hint say?', { at: today(10, 4) }),
      a('One line under the sidebar\'s Everything row: "Your chats with every space, in one place." Should I start on them?', { at: today(10, 5), suggests: ['Yes, do those three', 'Do all four', 'status?'] }),
    ], sonnet),
    chat(P.garden, [a('GARDEN-3 is in progress, about 20 minutes left.'), { id: `m${++n}`, who: 'agent', news: { task: 'vm:GARDEN-4', ref: 'GARDEN-4', event: 'needs-you', needs: 'asks', mark: 'needs', what: 'needs the person', text: 'I need an image library to resize the photos.' } }, ask('q-pil', 'Run a command', byPhoto, ['Allow once', 'Decline'], { command: 'pip install pillow' })], gpt),
    chat('SHOP-14/worker', [a('I compared both for the shop. Stripe is already used for your invoices. Adyen gets cheaper above 50k a month but needs two weeks of paperwork.'), ...payQ().map((x, i) => (i ? x : { ...x, suggests: ['Go with Stripe', 'Compare the fees again'] }))], opus),
    // said after it handed in (#1475): its Ready card still comes last
    // dmalis/shepherdr#42: its hand-in, read as the service reads it, and its two reviewers that finished
    chat('SHOP-21/worker', [a('Starting on the thumbnails.', { at: NOW - 50 * min }), ((h) => a(h?.text ?? SHOP21_HANDIN, { at: NOW - 10 * min, ...(h ? { suggests: h.suggests } : {}) }))(plainSuggests(SHOP21_HANDIN))], opus, {
      jobs: [
        { id: 'c:shop-21-review', kind: 'child', title: 'Reviewer · Codex', at: NOW - 30 * min, ended: NOW - 22 * min, status: 'done', role: 'reviewer', cli: 'codex' },
        { id: 'c:shop-21-review-2', kind: 'child', title: 'Reviewer · Codex', at: NOW - 18 * min, ended: NOW - 12 * min, status: 'done', role: 'reviewer', cli: 'codex' },
      ] }),
    chat('SHOP-12/worker', [a('Search is done. I added an index and cached the top queries.', { at: NOW - 8 * hour - min }), me('Does it still find misspelled names?', { at: NOW - hour }), a('Yes: the fuzzy match runs before the cache. I added a test for it.', { at: NOW - hour + 2 * min, suggests: ['Looks good, merge it', 'Show me the diff', 'status?'] })], opus),
    chat('BLOG-12/worker', [ask('scr-t42-1', 'Trust this folder?', undefined, ['Trust this folder and start', 'No, stop the task'], { press: true, noNote: true,
      // its task folder is a worktree of the blog repo: the card's tip trusts the repo once (service/trust-tip.ts)
      trust: { cli: 'Claude Code', folder: '/Users/sam/.local/share/shepherdr/worktrees/blog/add-an-rss-feed', waits: "Claude Code won't start in /Users/sam/.local/share/shepherdr/worktrees/blog/add-an-rss-feed until you trust this folder.", allows: "Trusting it lets the folder's project settings and hooks run.",
        tip: { key: 'mac-mini:claude:/Users/sam/dev/blog', machine: 'mac-mini', folder: '/Users/sam/dev/blog', lead: "Trust this repo once, so its next tasks don't ask:", command: 'cd /Users/sam/dev/blog && claude', then: 'answer “Yes, I trust this folder”, then type /exit.', covers: 'Its task folders are worktrees of it, so trusting it covers them.' } } })], opus),
    chat('BLOG-10/worker', [a('Fixed it straight in the blog folder, as this space is set up.')], opus),
    chat('NOTES-4/worker', [a('I read the three quotes in your notes folder and wrote up a comparison.')], opus),
    chat('DOCS-3/worker', docsQ(), opus),
    chat('studio:SITE-5/worker', spamQ(), opus),
    chat('vm:ACME-10/worker', labelsQ(), gpt),
    chat('studio:SITE-6/worker', [a('The banner is one short line now, with Accept and Refuse side by side.')], opus),
    chat('vm:ROOT-3/worker', [a('The export writes a CSV per day. One test failed on the date format; fixing it.')], opus),
    chat(P.vmRoot, [a('Started Order export as CSV.'), a('Its checks failed on one test. It is fixing it, nothing for you yet.')], sonnet),
    chat('vm:GARDEN-4/worker',permQ().map((x, i) => (i ? x : { ...x, suggests: ['Allow it once'] })), opus),
    chat('SHOP-17/worker', [a("I'm downloading October's invoices. The billing portal sent a sign-in code to your phone, so I need you for this one step.")], opus),
    chat('SHOP-15/worker', [brief('Bigger checkout button on phones', LONG_BRIEF, 'read', NOW - 10 * min), a('Started. Making the checkout button full width on phones.'), relay('from', 'Assistant', 'Keep the total above the fold on a 360 px screen too.', NOW - 9 * min), did(NOW - 8 * min, [['read', 'Read checkout.css', ''], ['edit', 'Edit checkout.css', '+6 −2'], ['run', 'Run bun test', 'passed'], ['edit', 'Edit checkout.test.ts', '+12']], 'Ran 4 commands · edited 2 files'), relay('to', 'Assistant', 'Done: the total stays above the fold at 360 px. Screenshot in my chat.', NOW - 2 * min, { how: 'hc', state: 'delivered' }), a('Changing the button now. About 10 minutes left.', { suggest: 'Show me a screenshot when it is done' })], opus, { working: true, doing: "Running python3 - <<'EOF' p='web/checkout.css'", live: { id: 'live', at: NOW, rows: [], steps: 0 },
      // what it left running in the background, over its box (chat/jobs.tsx)
      jobs: [
        { id: 'b:dev', kind: 'shell', title: 'Dev server for the checkout page', at: NOW - 23 * min, command: 'bun run dev --port 5173', stop: true, more: 'output' },
        { id: 'b:watch', kind: 'monitor', title: 'Watch the checkout tests', at: NOW - 6 * min, command: 'bun test --watch checkout', stop: true, more: 'output' },
        { id: 'c:shop-15-review', kind: 'child', title: 'shop-15-review', at: NOW - 4 * min, chat: 'SHOP-16/worker', status: 'working', role: 'reviewer', cli: 'claude' },
      ] }),
    // its agent just started: the brief sent, not taken in yet, and words for it starting
    chat('SHOP-19/worker', [brief('Product page reviews', 'Show the three newest reviews under each product, with their stars. A product with none says "No reviews yet."', 'sent', NOW - min)], opus),
    // queued: no agent yet, its brief waits to be sent
    chat('BLOG-9/worker', [brief('Dark mode for code blocks', 'Adds a dark theme to the code blocks on the blog. It follows the reader\'s system setting; no switch on the page.', 'waiting')], undefined),
    chat('SHOP-16/worker', [a('Updating three packages. None are breaking changes.')], opus, { working: true, live: { id: 'live', at: NOW, rows: [], steps: 0 }, doing: 'Updating 3 packages' }),
    chat('vm:GARDEN-3/worker', [a('Reminders are built. Writing the tests now, about 20 minutes left.')], gpt, { working: true, live: { id: 'live', at: NOW, rows: [], steps: 0 }, doing: 'Writing tests' }),
  ].map((c) => [c.key, c]),
)
void byPay
void byPhoto
