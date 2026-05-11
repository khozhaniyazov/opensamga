/**
 * Thumbs-up / thumbs-down buttons shown under every assistant message.
 * Fires POST /api/feedback/chat with {message_id, rating, rag_query_log_id,
 * comment?}. Backend upserts by (message_id, user_id) so clicking again
 * flips the rating rather than creating duplicates.
 *
 * s26 phase 2 (2026-04-26 evening): premium feedback UX.
 *   - Thumbs split into emerald (positive) / rose (negative) so the
 *     active state communicates which way the user voted, not just
 *     "something is selected." Prior amber-on-both was indistinguishable.
 *   - Ghost-button shape (28×28, borderless) matching MessageActions —
 *     hover tints, no flat-form-button vibe.
 *   - On thumbs-down, a popover slides open offering a one-click
 *     reason ("Не по теме" / "Неточно" / "Неполно" / "Грубо") plus an
 *     optional free-text field. Submit re-fires POST /feedback/chat
 *     with the same {message_id, rating: -1, rag_query_log_id} plus a
 *     synthesized `comment` of the form "reason=<id>; <free text>".
 *     Backend already does last-write-wins UPSERT keyed on
 *     (message_id, user_id) (routers/feedback.py:55), so the second
 *     POST overwrites the first one's NULL comment cleanly.
 *   - Inline "Спасибо" pill flashes for ~1.5s after either rating.
 *
 * s26 phase 7 (2026-04-27): killed the dead POST /feedback/chat/comment
 *   call — that endpoint never existed on the backend so every comment
 *   was silently 404'ing. Now reuses /feedback/chat which has accepted
 *   `comment` since session 15.
 */

import { useEffect, useRef, useState } from "react";
import { ThumbsUp, ThumbsDown, Send, X } from "lucide-react";
import { apiPost } from "../../../lib/api";
import { trackFeedbackSubmitted } from "../../../lib/telemetry";
import { useLang } from "../../LanguageContext";
import { feedbackButtonAriaLabel } from "./feedbackButtonAriaLabel";
import { feedbackReasonChipAria } from "./feedbackReasonChipAria";
import { feedbackPopoverDialogAriaLabel } from "./feedbackPopoverDialogAria";
// s34 wave 7 (I3 closeout, 2026-04-28): canonical canned-reason
// list + comment packer extracted to a pure module so the analytics
// roll-up planned for I2 can recover the structured reason without
// duplicating the regex.
import {
  FEEDBACK_COMMENT_MAX_LEN,
  FEEDBACK_REASONS_KZ,
  FEEDBACK_REASONS_RU,
  packFeedbackComment,
  type FeedbackReasonId,
} from "./feedbackReasons";

interface Props {
  messageId: string;
  ragQueryLogId?: number | null;
}

export function FeedbackButtons({ messageId, ragQueryLogId = null }: Props) {
  const { lang } = useLang();
  const [rating, setRating] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [thanks, setThanks] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [reason, setReason] = useState<FeedbackReasonId | null>(null);
  const [comment, setComment] = useState("");
  const [submittedComment, setSubmittedComment] = useState(false);
  // s35 wave 78 / v3.78 (2026-05-03): surface comment-POST
  // failures instead of pretending success. Pre-v3.78 the catch
  // arm of submitComment() set submittedComment=true and
  // auto-closed the popover, so a network/backend failure
  // rendered identically to a successful submit — the user saw
  // "Спасибо, мы прочитаем" and walked away believing their
  // reason/comment was recorded when it wasn't. This local
  // string is set from the catch branch and cleared on every
  // retry / reason-change / text-change.
  const [commentError, setCommentError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!popoverOpen) return;
    function onClick(e: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setPopoverOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPopoverOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [popoverOpen]);

  async function submit(next: number) {
    if (busy) return;
    const target = rating === next ? 0 : next;
    setBusy(true);
    try {
      await apiPost("/feedback/chat", {
        message_id: messageId,
        rating: target,
        rag_query_log_id: ragQueryLogId,
      });
      setRating(target);
      if (target === 1 || target === -1) {
        try {
          trackFeedbackSubmitted({
            rag_query_log_id: ragQueryLogId,
            rating: target,
          });
        } catch {
          /* noop */
        }
        setThanks(true);
        window.setTimeout(() => setThanks(false), 1500);
        if (target === -1) {
          setPopoverOpen(true);
          setReason(null);
          setComment("");
          setSubmittedComment(false);
          setCommentError(null);
        }
      }
    } catch {
      // Silent fail — feedback is best-effort.
    } finally {
      setBusy(false);
    }
  }

  async function submitComment() {
    if (busy) return;
    if (!reason && !comment.trim()) return;
    setBusy(true);
    setCommentError(null);
    // s34 wave 7 (I3 closeout): pack via the shared helper so the
    // wire format is one-source-of-truth with the analytics parser.
    const packed = packFeedbackComment(reason, comment);
    try {
      await apiPost("/feedback/chat", {
        message_id: messageId,
        rating: -1,
        rag_query_log_id: ragQueryLogId,
        comment: packed || null,
      });
      setSubmittedComment(true);
      window.setTimeout(() => setPopoverOpen(false), 800);
    } catch {
      // s35 wave 78 / v3.78 (2026-05-03): pre-v3.78 this catch
      // also called setSubmittedComment(true) and auto-closed the
      // popover, on the rationale that the rating itself is
      // already persisted from the initial thumbs-down press.
      // The reason/comment payload is NOT persisted on failure
      // though, and the success-styled "Спасибо, мы прочитаем"
      // pill misled users into believing it was. Now we keep the
      // popover open with an inline error + a re-enabled Send so
      // the user can retry. The initial -1 rating remains
      // persisted from the prior POST regardless.
      setCommentError(
        lang === "kz"
          ? "Жіберу сәтсіз аяқталды. Қайта көріңіз."
          : "Не удалось отправить. Попробуйте снова.",
      );
    } finally {
      setBusy(false);
    }
  }

  // s34 wave 1 (G5, 2026-04-28): same tap-target expansion pattern
  // as MessageActions — 28px visual button, 44+px hit area via
  // before:inset-[-8px] pseudo-element. WCAG 2.5.5 AAA / Apple HIG.
  const baseGhost =
    "relative inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-all duration-150 hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 before:absolute before:inset-[-8px] before:content-[''] before:rounded-lg";

  const upActive = rating === 1;
  const downActive = rating === -1;

  const reasons = lang === "kz" ? FEEDBACK_REASONS_KZ : FEEDBACK_REASONS_RU;

  return (
    <div ref={wrapperRef} className="relative flex items-center gap-0.5">
      <button
        type="button"
        onClick={() => void submit(1)}
        disabled={busy}
        className={
          baseGhost +
          (upActive
            ? " !bg-emerald-50 !text-emerald-600 hover:!bg-emerald-100"
            : "")
        }
        // s35 wave 20b (2026-04-28): state-aware aria-label —
        // when the rating is already set, the SR phrase tells
        // users how to *unset* it ("нажмите ещё раз, чтобы убрать
        // оценку"). aria-pressed still flips for AT modes that
        // surface it natively; the label-level cue is
        // complementary for AT versions that don't.
        aria-label={feedbackButtonAriaLabel({
          direction: "up",
          active: upActive,
          lang: lang === "kz" ? "kz" : "ru",
        })}
        title={lang === "kz" ? "Пайдалы" : "Полезно"}
        aria-pressed={upActive}
      >
        <ThumbsUp size={14} />
      </button>
      <button
        type="button"
        onClick={() => void submit(-1)}
        disabled={busy}
        className={
          baseGhost +
          (downActive ? " !bg-rose-50 !text-rose-600 hover:!bg-rose-100" : "")
        }
        // s35 wave 20b: state-aware aria-label, mirror of the up
        // button.
        aria-label={feedbackButtonAriaLabel({
          direction: "down",
          active: downActive,
          lang: lang === "kz" ? "kz" : "ru",
        })}
        title={lang === "kz" ? "Пайдалы емес" : "Не полезно"}
        aria-pressed={downActive}
      >
        <ThumbsDown size={14} />
      </button>
      {thanks ? (
        <span
          className="ml-1 inline-flex items-center gap-1 rounded-md bg-zinc-100/80 px-1.5 py-0.5 text-[10.5px] font-medium text-zinc-600 samga-anim-feedback-thanks"
          role="status"
        >
          {lang === "kz" ? "Рақмет" : "Спасибо"}
        </span>
      ) : null}
      {popoverOpen ? (
        <div
          ref={popoverRef}
          className="absolute left-0 top-9 z-30 w-[280px] rounded-xl border border-zinc-200 bg-white p-3 shadow-[0_8px_24px_-8px_rgba(24,24,27,0.18)] samga-anim-popover"
          role="dialog"
          // s35 wave 31c (2026-04-28): the dialog had no
          // accessible name — SR users heard only "dialog" with
          // no hint of purpose. Helper synthesises a state-aware
          // label that names the form (RU/KZ) and the rating
          // direction it's collecting reasons for.
          aria-label={feedbackPopoverDialogAriaLabel({
            direction: downActive ? "down" : upActive ? "up" : null,
            lang: lang === "kz" ? "kz" : "ru",
          })}
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="text-[12px] font-semibold text-zinc-800">
              {lang === "kz" ? "Не дұрыс емес?" : "Что было не так?"}
            </div>
            <button
              type="button"
              onClick={() => setPopoverOpen(false)}
              className="-mt-0.5 -mr-0.5 inline-flex h-5 w-5 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
              aria-label={lang === "kz" ? "Жабу" : "Закрыть"}
            >
              <X size={12} />
            </button>
          </div>
          {submittedComment ? (
            <div className="rounded-lg bg-emerald-50/80 px-2 py-1.5 text-[12px] text-emerald-700">
              {lang === "kz" ? "Рақмет, біз оқимыз." : "Спасибо, мы прочитаем."}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-1">
                {reasons.map((r) => {
                  const active = reason === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        setReason(active ? null : r.id);
                        // v3.78: changing the selected reason
                        // clears any prior submit error so the
                        // user's next click feels fresh.
                        setCommentError(null);
                      }}
                      className={
                        "rounded-full border px-2 py-0.5 text-[11px] transition-colors " +
                        (active
                          ? "border-rose-300 bg-rose-50 text-rose-700"
                          : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-800")
                      }
                      // s35 wave 21b (2026-04-28): contextual aria
                      // + aria-pressed so SR users hear the chip
                      // is a toggle and learn how to deselect it.
                      // Visible chrome unchanged.
                      aria-pressed={active}
                      aria-label={feedbackReasonChipAria({
                        label: r.label,
                        active,
                        lang: lang === "kz" ? "kz" : "ru",
                      })}
                    >
                      {r.label}
                    </button>
                  );
                })}
              </div>
              <textarea
                value={comment}
                onChange={(e) => {
                  setComment(e.target.value);
                  // v3.78: typing clears prior submit error.
                  if (commentError) setCommentError(null);
                }}
                rows={2}
                maxLength={FEEDBACK_COMMENT_MAX_LEN}
                placeholder={
                  lang === "kz"
                    ? "Қосымша түсініктеме (қалауыңызша)"
                    : "Дополнительный комментарий (по желанию)"
                }
                className="mt-2 w-full resize-none rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-[12px] leading-snug text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
              />
              {commentError ? (
                <div
                  className="mt-2 rounded-md bg-rose-50 px-2 py-1.5 text-[11.5px] text-rose-700"
                  role="alert"
                  data-testid="feedback-comment-error"
                >
                  {commentError}
                </div>
              ) : null}
              <div className="mt-2 flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setPopoverOpen(false)}
                  className="rounded-md px-2 py-1 text-[11px] font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700"
                >
                  {lang === "kz" ? "Бас тарту" : "Отмена"}
                </button>
                <button
                  type="button"
                  onClick={() => void submitComment()}
                  disabled={busy || (!reason && !comment.trim())}
                  className={
                    "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors " +
                    (busy || (!reason && !comment.trim())
                      ? "bg-zinc-100 text-zinc-400 cursor-not-allowed"
                      : "bg-zinc-900 text-white hover:bg-zinc-800")
                  }
                >
                  <Send size={11} />
                  {lang === "kz" ? "Жіберу" : "Отправить"}
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default FeedbackButtons;
