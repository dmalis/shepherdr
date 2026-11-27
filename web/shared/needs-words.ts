// The words of Needs you's tiers (dmalis/shepherdr#77's copy table), in one place, so every view says the same thing
// and a change of words is a change of one line here. The rule for which tier a wait is in is needs-you.ts's
// (forAssistant); these are only its words.

export const TIER_WORDS = {
  /** something only the person can do now: red, the only tier that notifies */
  person: 'Needs you',
  /** a wait its space's Assistant handles first: grey, visible and quiet (dmalis/shepherdr#114) */
  assistant: 'Assistant handling',
  /** a task stopped on an error, under the Assistant's tier */
  failed: 'Failed',
} as const

/** the grey tier's label for a wait: "Assistant handling · <what>" (none: the tier's word alone) */
export const assistantLabel = (what?: string) => (what ? `${TIER_WORDS.assistant} · ${what}` : TIER_WORDS.assistant)
