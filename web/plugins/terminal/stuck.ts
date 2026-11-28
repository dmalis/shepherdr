// "Waiting at a prompt" (dmalis/shepherdr#132, slice 10): what the chat's banner says when an agent's session waits for
// input that is not one of the app's own cards. One prompt is one banner with its words first; several fold into one
// banner whose button lists each, as Everything's warnings do ("2 things need a look"), so they never stack over the
// message box. Kept apart from the banner itself so a test can run it without a screen.

/** one session waiting at a prompt: this chat's own agent, or a task's */
export interface Prompt {
  key: string
  /** the task's name; none for this chat's own agent */
  task?: string
}

/** the banner's words: what waits, whole, so a phone wraps them rather than cutting them */
export function stuckWords(prompts: Prompt[]): string {
  const own = prompts.some((p) => !p.task)
  const tasks = prompts.filter((p) => p.task)
  if (!tasks.length) return 'Waiting at a prompt'
  if (!own && tasks.length === 1) return `${tasks[0]!.task} is waiting at a prompt`
  const n = `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`
  return own ? `This chat and ${n} are waiting at a prompt` : `${n} are waiting at a prompt`
}

/** a row of the folded banner's list: this chat first, then each task by its name */
export const promptLabel = (p: Prompt) => p.task ?? 'This chat'
