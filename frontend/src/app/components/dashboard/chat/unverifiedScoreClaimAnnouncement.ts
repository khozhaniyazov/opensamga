/**
 * s35 wave 42 (I5, 2026-04-28) — pure helpers for auto-flagging
 * assistant replies that contain a user-score-shaped claim.
 *
 * Boss brief from roadmap row I5: "Auto-flag any reply containing
 * `_USER_SCORE_RE` match for QA review". Today the agent loop's
 * `_redact_unverified_score_claims` (backend agent_loop.py) drops
 * sentences pairing a 2nd-person pronoun with a score-shaped number
 * BUT only when no user-data tool fired this turn — and the visible
 * RedactionPill (s27 C1) only surfaces when redaction *happened*.
 *
 * I5 closes the gap: when an assistant reply still contains a
 * score-shaped pronoun-anchored sentence (e.g. the agent skipped
 * redaction because a tool DID fire, but the surfaced sentence
 * still references the user's score), we want an SR-only cue so
 * accessibility users hear "the response contains a score number
 * — verify the bot consulted your real data" before they trust it.
 *
 * Mirrors backend regex contract:
 *   _USER_PRONOUN_RE: 2nd-person RU/KZ pronouns + their possessive
 *     forms ("ты/тебе/твой/твои", "вы/вам/ваш/ваши", "сен/сенің",
 *     "сіз/сіздің", "сенің/сіздің ұпайың", etc.).
 *   _USER_SCORE_RE: score-shaped numbers in UNT context — "X из 140",
 *     "X/140", "N баллов / балл / балла", "N ұпай", "N%", bare "X/Y".
 *
 * Implementation choice: we DON'T re-implement the full backend
 * regex (Cyrillic class precision drift would create false
 * positives). We re-use the relaxed shape that's good enough for
 * an SR cue: any 2nd-person pronoun token + any score-shaped
 * number on the same line / sentence. False positives are
 * tolerable because the cue is non-blocking and only audible.
 *
 * Pure: no DOM, no React, no Intl, no network.
 */

/** RU/KZ second-person pronouns (broad, lowercase). Mirrors the
 *  shape of backend _USER_PRONOUN_RE but keeps us decoupled. */
const PRONOUN_PATTERN =
  /(?:^|[^\p{L}\p{N}_])(ты|тебя|тебе|тобой|твой|твоя|твоё|твои|вы|вас|вам|вами|ваш|ваша|ваше|ваши|сен|сені|саған|сенің|сендердің|сіз|сізді|сізге|сіздің|сіздер|нәтижең|нәтижеңіз|балың|балыңыз|ұпайың|ұпайыңыз)(?:[^\p{L}\p{N}_]|$)/iu;

/** Score-shaped numbers (UNT context). Mirrors the shape of backend
 *  _USER_SCORE_RE without claiming bit-exact parity. We extend the
 *  backend's number-then-noun rule to also catch noun-then-number
 *  ("балл 95", "ұпайың 95") because a stitched-together model
 *  reply is just as likely to phrase it that way. */
const SCORE_PATTERN =
  /\b\d{1,3}\s*(?:из|\/|\\)\s*140\b|\b\d{1,3}\s*из\s*\d{1,3}\s*балл|\b\d{1,3}\s*балл|\b\d{1,3}\s*ұпай|\b\d{1,3}\s*%|\b\d{1,3}\s*\/\s*\d{1,3}\b|балл(?:а|ов|ы)?\s+\d{1,3}\b|ұпай(?:ың|ыңыз)?\s+\d{1,3}\b|результат\s+\d{1,3}\b/iu;

/** Pure helper — true iff the input contains BOTH a 2nd-person
 *  pronoun AND a score-shaped number in the same text body.
 *  Defensive: non-string ⇒ false. Empty ⇒ false. */
export function containsUnverifiedScoreClaim(
  text: string | null | undefined,
): boolean {
  if (typeof text !== "string") return false;
  if (text.trim().length === 0) return false;
  return PRONOUN_PATTERN.test(text) && SCORE_PATTERN.test(text);
}

/** Pure helper — RU/KZ SR-only sentence. Single-source-of-truth so
 *  the announcer + any future visible-chrome sibling pull from the
 *  same copy. */
export function unverifiedScoreClaimAnnouncementText(args: {
  lang: "ru" | "kz";
}): string {
  if (args.lang === "kz") {
    return "Жауапта балл саны бар — бот сіздің нақты деректеріңізді көрді ме, тексеріңіз.";
  }
  return "В ответе указан балл — проверьте, что бот посмотрел ваши настоящие данные.";
}

/** Pure helper — strict-equality dedupe predicate. Returns true
 *  iff the announcer should fire for `messageId` given the last
 *  announced id. Mirrors `shouldAnnounceNetworkError` (wave 39). */
export function shouldAnnounceUnverifiedScoreClaim(args: {
  messageId: string | null | undefined;
  lastAnnouncedId: string | null | undefined;
}): boolean {
  const { messageId, lastAnnouncedId } = args;
  if (typeof messageId !== "string" || messageId.length === 0) return false;
  if (messageId === lastAnnouncedId) return false;
  return true;
}
