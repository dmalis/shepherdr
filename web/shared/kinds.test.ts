// dmalis/shepherdr "Chat: say what each thing is": alerts, the alerts list and Glance name a task with its kind first,
// a schedule's run as one, and a watch's short line cuts the name, never what happened.
import { expect, test } from 'bun:test'
import { cutKindTitle, fitWho, kindWho, taskKind } from './kinds.ts'
import { taskWho, watchTitle, WATCH_TITLE } from './alerts.ts'

test("a task is a Task, a schedule's run says so", () => {
  expect(taskKind({})).toBe('Task')
  expect(taskKind(null)).toBe('Task')
  expect(taskKind({ schedule: 'Install merged' })).toBe('Schedule run')
  expect(kindWho('Task', 'Fix login')).toBe('Task · Fix login')
})

test("an alert names a known task with its kind; one the snapshot lost keeps its key", () => {
  const snap = { machines: [{ machine: 'm3', name: 'Mac mini' }], tasks: [{ id: 'SD-7', name: 'Install merged', schedule: 'Install merged' }, { id: 'SD-8', name: 'Fix login' }] } as any
  expect(taskWho(snap, 'SD-7')).toBe('Schedule run · Install merged')
  expect(taskWho(snap, 'SD-8')).toBe('Task · Fix login')
  expect(taskWho(snap, 'm3:SD-9')).toBe('SD-9 on Mac mini')
})

test("a watch's line cuts the name, keeping the kind and what happened while the name stays readable", () => {
  expect(cutKindTitle('Task · Fix login · Done', WATCH_TITLE)).toBeNull()
  // ten letters of the name, not counting spaces or the …: 'Faster pro…' has nine, so the name comes first
  expect(watchTitle('Task · Faster product search · Needs you')).toBe('Faster product se… · Needs you')
  expect(watchTitle('Task · Faster product searches · Done')).toBe('Task · Faster product… · Done')
  expect(watchTitle('Schedule run · Install merged · Done')).toBe('Run · Install merged · Done')
  expect(watchTitle('Schedule run · Look for stuck work · Working')).toBe('Run · Look for stuc… · Working')
  // no room for a readable name with its kind: the name comes first on a watch (the alerts list keeps the whole title)
  expect(watchTitle('Task · Fix login · Ready for review')).toBe('Fix login · Ready for review')
  // an Assistant's title is cut as before
  expect(watchTitle('#tt-repo-with-a-long-name · Needs you')).toBe('#tt-repo-with-a-l… · Needs you')
  for (const t of ['Task · Faster product search · Needs you', 'Schedule run · Install merged · Done and merged']) expect(watchTitle(t).length).toBeLessThanOrEqual(WATCH_TITLE)
})

test("an alert's title shortens a long name, never what happened (the alerts list keeps it, the watch cuts from it)", () => {
  const t = fitWho('Schedule run · Double-check the warehouse inventory counts', 'Needs review', 60)
  expect(t).toBe('Schedule run · Double-check the warehouse in… · Needs review')
  expect(t.length).toBeLessThanOrEqual(60)
  expect(watchTitle(t)).toBe('Double-check t… · Needs review')
  expect(fitWho('Task · Fix login', 'Needs you', 60)).toBe('Task · Fix login · Needs you')
  expect(fitWho('#shop', 'Needs you', 60)).toBe('#shop · Needs you')
})
