// "Waiting at a prompt" (dmalis/shepherdr#132, slice 10): what the chat's banner says when an agent's session waits for
// input that is not one of the app's own cards. One prompt is one banner with its words first; several fold into one
// banner whose button lists each, as Everything's warnings do ("2 things need a look"), so they never stack over the
// message box. Kept apart from the banner itself so a test can run it without a screen.

/** one session waiting at a prompt: this chat's own agent, or a task's */
export interface Prompt {
  key: string
  /** the task's name; none for this chat's own agent */
  task?: string
  /** the task's id (SHOP-4), to tell two tasks of one name apart */
  id?: string
}

/** the banner's words: why it is there first, so a name long enough to be cut on a phone never hides it */
export function stuckWords(prompts: Prompt[]): string {
  const own = prompts.some((p) => !p.task)
  const tasks = prompts.filter((p) => p.task)
  if (!tasks.length) return 'Waiting at a prompt'
  if (!own && tasks.length === 1) return `Waiting at a prompt · ${tasks[0]!.task}`
  const n = `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`
  return own ? `This chat and ${n} are waiting at a prompt` : `${n} are waiting at a prompt`
}

/** the folded banner's list, in its order: this chat, then each task by its name, with its id where two share one (a
 *  menu's rows are told apart by their words, on the screen and by a screen reader) */
export function promptLabels(prompts: Prompt[]): string[] {
  const named = (p: Prompt) => p.task ?? 'This chat'
  return prompts.map((p) => (p.task && p.id && prompts.some((o) => o !== p && named(o) === p.task) ? `${p.task} · ${p.id}` : named(p)))
}
