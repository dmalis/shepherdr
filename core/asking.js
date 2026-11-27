// dmalis/shepherdr#59: a message sent while its agent waits on its own question (a question, a permission, a plan).
// Nothing is typed and no key closes it (AGENTS.md "Nothing that risks a ban"): the message waits for it to be
// answered, then goes by itself (service/actions.ts `held`). Where it is answered: on its card in the chat when one
// shows it (a hook ask, service/asks.ts), else in its terminal. Every line about it says the same words: the box and
// the waiting message's row (web/plugins/chat/asking-box.tsx), and what can't wait (a reaction: service/actions.ts;
// a send refused by hc: core/send.js sendBody).

/** A message waiting for the card above to be answered. */
export const AFTER = "Sends after you answer the card above.";
/** One waiting for a question only its terminal can answer (a CLI's own menu). */
export const AFTER_TERMINAL = "Sends after you answer it in its terminal.";
/** What can't wait for it: answer it first. */
export const ASKING = "Answer the card above first.";
export const ASKING_TERMINAL = "Answer it in its terminal first.";

/** card: a card in its chat answers the question. */
export const afterWords = (card) => (card ? AFTER : AFTER_TERMINAL);
export const askingWords = (card) => (card ? ASKING : ASKING_TERMINAL);

/** a held message's waitsFor while its agent asks (web/shared/types.ts Message.waitsFor) */
export const WAITS_ANSWER = "answer";
