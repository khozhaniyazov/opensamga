/**
 * s35 wave 13 (2026-04-28) — composer length-counter announcer
 * throttle.
 *
 * The composer counter ("3 800 / 8 000") shows once the user crosses
 * the soft limit (4 000 chars) and turns red past the hard limit
 * (8 000). Until s35 it sat inside `aria-live="polite"` directly, so
 * screen readers announced every keystroke from char 4 000 onward —
 * a 4 001-character paragraph produced 4 001 announcements. Boss
 * concern: this is unusable with VoiceOver / NVDA.
 *
 * Fix: announce only when the user crosses a milestone, so a long
 * paragraph yields at most three announcements (entered the warn
 * zone, hit 80%, hit the hard cap). The pure helper below maps a
 * (len, soft, hard) triple to a milestone bucket; a small ref-based
 * throttle in ChatComposer compares the new bucket to the previous
 * one and only feeds the aria-live cell when they differ. This
 * leaves the visible counter unchanged (it still updates every
 * keystroke) — only the SR channel is throttled.
 *
 * Buckets:
 *   - "below" — under the soft limit; nothing to announce.
 *   - "soft"  — >= soft and < 80% of the way to hard. The first time
 *               we hit this bucket, announce "you are approaching
 *               the limit".
 *   - "warn"  — >= 80% of the way to hard, but still <= hard. The
 *               first time we hit this bucket, announce "almost at
 *               the limit, N characters remaining".
 *   - "over"  — strictly above hard. Announce "over the limit" and
 *               stay silent until the user dips back into a lower
 *               bucket.
 *
 * Pure: no DOM access. Vitest pins the bucket transitions plus the
 * RU/KZ copy.
 */

export type ComposerCounterMilestone = "below" | "soft" | "warn" | "over";

export interface ComposerCounterMilestoneArgs {
  len: number;
  soft: number;
  hard: number;
}

/** Pure helper — classify a current length into one of four
 *  milestone buckets. Defensive against soft >= hard or negative
 *  inputs. */
export function composerCounterMilestone(
  args: ComposerCounterMilestoneArgs,
): ComposerCounterMilestone {
  const len = Math.max(0, Math.floor(args.len ?? 0));
  const soft = Math.max(0, Math.floor(args.soft ?? 0));
  const hard = Math.max(soft + 1, Math.floor(args.hard ?? 0));
  if (len <= soft) return "below";
  if (len > hard) return "over";
  // 80% threshold of the warn zone is computed against `hard` (not
  // `hard - soft`) to match the visible red-tint behaviour: warn at
  // 80% of the absolute hard cap, not 80% of the soft-to-hard band.
  const warnFloor = Math.floor(hard * 0.8);
  if (len >= warnFloor) return "warn";
  return "soft";
}

/** Pure helper — translate a milestone transition into the SR
 *  string the announcer should speak. Returns the empty string when
 *  the bucket is "below" or when the new bucket equals the
 *  previously-announced one (idempotent — the caller can blindly
 *  replace its aria-live cell text every render). */
export function composerCounterAnnouncement(
  prev: ComposerCounterMilestone,
  next: ComposerCounterMilestone,
  args: ComposerCounterMilestoneArgs,
  lang: "ru" | "kz",
): string {
  if (next === prev) return "";
  if (next === "below") return "";
  const len = Math.max(0, Math.floor(args.len ?? 0));
  const hard = Math.max(0, Math.floor(args.hard ?? 0));
  const remaining = Math.max(0, hard - len);
  const over = Math.max(0, len - hard);
  if (lang === "kz") {
    if (next === "soft") {
      return `Хабарлама шегіне жақындап келесіз: ${remaining} таңба қалды.`;
    }
    if (next === "warn") {
      return `Шекке өте жақын: ${remaining} таңба қалды.`;
    }
    return `Шектен асып кетті: ${over} таңбаға артық.`;
  }
  if (next === "soft") {
    return `Приближаетесь к лимиту сообщения: осталось ${remaining} символов.`;
  }
  if (next === "warn") {
    return `Почти у лимита: осталось ${remaining} символов.`;
  }
  return `Превышен лимит: на ${over} символ(ов) больше.`;
}
