// The words of Needs you's tiers (dmalis/shepherdr#77's copy table), in one place, so every view says the same thing
// and a change of words is a change of one line here. The rule for which tier a wait is in is needs-you.ts's
// (forAssistant, waitsOnPerson); these are only its words. The app says Shepherdr, never Assistant (docs/develop.md).

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
