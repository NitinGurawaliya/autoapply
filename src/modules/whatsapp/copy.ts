import { appBase } from "./state";

/**
 * Phase Y: every string the agent writes on WhatsApp, one place (docs/whatsapp/TDD.md 4.12). The lines are taken from
 * design/whatsapp.html (Y1, branch claude/quirky-visvesvaraya-9c78d3), whose words the owner is still to approve; Y3 to Y5
 * add theirs here. No emoji; WhatsApp's own `*bold*` for what matters. No resume text, email or phone in any line.
 */
export const copy = {
  /** After "Join <code>" is accepted (Y1 page, chat, "Linked."). */
  linked: (morningAt: string) => `Linked. I'll message you at ${morningAt} with the day's jobs; write *jobs* any time.\nWrite *stop* to stop.`,
  /** One reply to a number nobody linked, once a day, nothing more (TDD 4.5 item 4; Y1 page, "A stranger's number"). */
  stranger: () => `This is SwipeApply's agent. Link your account from the app: ${appBase()}/account`,
  /** A "Join <code>" that was refused. Not on the Y1 page: new in Y2, for the owner's eye with the rest. */
  codeRefused: () => `That code didn't work. A code lasts 15 minutes and works once. Make a new one in the app: ${appBase()}/account`,
};
