// The words of Needs you (fork/specs/needs-you.md's words table), in one place, so every view says the same thing
// and a change of words is a change of one line here. Which actions are whose is web/shared/attention.ts's rule; these
// are only its words. The app says Shepherdr, never Assistant (docs/develop.md).

export const TIER_WORDS = {
  /** the person has a next action: red, the only tier that notifies */
  person: 'Needs you',
  /** a wait the space's Shepherdr chat handles first: quiet, never counted (dmalis/shepherdr#114) */
  shepherdr: 'With Shepherdr',
  /** an old news line whose owner is unknown (from before lines said whose wait it was) */
  unknown: 'Waiting',
} as const

export type Tier = keyof typeof TIER_WORDS

/** a tier's label for a wait: "<tier> · <what>" (none: the tier's word alone) */
export const tierLabel = (tier: Tier, what?: string) => (what ? `${TIER_WORDS[tier]} · ${what}` : TIER_WORDS[tier])

/** what has no owner: nothing waits on anyone */
export const NEUTRAL_WORDS = {
  working: 'Working',
  /** stopped by the person: the next message carries on */
  paused: 'Paused',
  checks: "Waiting for GitHub's checks",
  brief: 'Waiting for the brief',
} as const

/** nothing open for the person */
export const NOTHING_NEEDS_YOU = 'Nothing needs you'

/** a wait Shepherdr would handle, in a space where no Shepherdr chat runs: the person's */
export const NO_SHEPHERDR = 'No Shepherdr chat is running here'
export const START_SHEPHERDR = 'Start it'

/** a machine its last known row comes from, that can't be read now */
export const cantCheck = (machine: string) => `Can't check ${machine} right now`

/** a late tap on an action that closed: answered, or its task moved on by itself (fork Needs you 4/6: a space's own ask
 *  that went on by itself has no task: it no longer waits) */
export const CLOSED_WORDS = { answered: 'Answered', moved: 'Task moved on', over: 'No longer waiting' } as const
