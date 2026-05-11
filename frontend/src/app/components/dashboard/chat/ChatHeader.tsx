/**
 * Phase B (s21, 2026-04-22): header bar — title/subtitle, model badge,
 * daily-usage readout, clear-history trigger.
 *
 * Presentational. All data flows in via props / context. No async.
 */

import {
  Bot,
  CircleGauge,
  HelpCircle,
  MessageSquareText,
  Trash2,
} from "lucide-react";
import { useLang } from "../../LanguageContext";
import { usePlan } from "../../billing/PlanContext";
import { useMessages } from "./MessagesContext";
import { chatHeaderUsageAria, clearChatButtonAria } from "./chatHeaderAria";
import { messageCountLabel } from "./messageCountLabel";

interface ChatHeaderProps {
  onClearRequest: () => void;
  /** Phase C (s22): opens the keyboard-shortcut help overlay. Optional
   *  so legacy call-sites / storybook can keep rendering this header
   *  without wiring the overlay. */
  onShortcutsRequest?: () => void;
}

export function ChatHeader({
  onClearRequest,
  onShortcutsRequest,
}: ChatHeaderProps) {
  const { t, lang } = useLang();
  const { billing } = usePlan();
  const { messages, threads, activeThreadId } = useMessages();

  const usedToday = billing.usage.chatMessages;
  const limitToday = billing.limits.chatMessagesPerDay;
  const nearLimit = limitToday > 0 && usedToday >= limitToday * 0.8;
  const isEmpty = messages.length === 0;
  // s26 phase 3: when a thread is active, prefer its title as the
  // header headline so the header doubles as a thread context cue
  // instead of always rendering the static "Чат с Samga" copy.
  const activeThread =
    activeThreadId == null
      ? null
      : (threads.find((th) => th.id === activeThreadId) ?? null);
  const headerTitle =
    activeThread && activeThread.title && activeThread.title.trim().length > 0
      ? activeThread.title
      : t("chat.title");
  // s35 wave 44 (2026-04-28): the inline ternary above used to
  // emit "1 сообщений" / "2 сообщений" / "5 сообщений" — always
  // the genitive plural — because it ignored the RU paucal table.
  // `messageCountLabel` applies the full table (1 → singular,
  // 2-4 → paucal, 5-20 + teens 11-14 → genitive, units rule for
  // 21/22/...) plus the KZ uninflected mirror.
  const headerSubtitle =
    activeThread && activeThread.title
      ? messages.length > 0
        ? messageCountLabel({
            count: messages.length,
            lang: lang === "kz" ? "kz" : "ru",
          })
        : t("chat.subtitle")
      : t("chat.subtitle");

  return (
    <div className="flex min-w-0 items-center justify-between gap-2 sm:gap-3">
      <h1 className="sr-only sm:hidden">{t("chat.title")}</h1>
      <div className="hidden min-w-0 items-center gap-3 sm:flex">
        <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-100 to-amber-50 text-amber-700 ring-1 ring-amber-200/80 shadow-[0_2px_4px_-2px_rgba(180,83,9,0.15)] sm:inline-flex">
          <MessageSquareText size={17} />
        </span>
        <div className="min-w-0">
          <h1
            className="truncate text-zinc-950"
            style={{ fontSize: 17, fontWeight: 720, lineHeight: 1.2 }}
            title={headerTitle}
          >
            {headerTitle}
          </h1>
          <p
            className="mt-0.5 hidden truncate text-zinc-500 md:block"
            style={{ fontSize: 12, lineHeight: 1.55 }}
          >
            {headerSubtitle}
          </p>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:flex-none">
        {onShortcutsRequest && (
          <button
            type="button"
            onClick={onShortcutsRequest}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-zinc-500 transition-colors hover:border-amber-200 hover:bg-amber-50 hover:text-amber-700"
            aria-label={
              t("chat.shortcuts.title") ||
              (lang === "kz" ? "Пернетақта қысқартулары" : "Горячие клавиши")
            }
            title={
              // s35 wave 25b (2026-04-28): single-space separator
              // between the verb and the "(?)" hotkey hint. Was
              // doubled, which renders as a literal `  ` in the
              // browser tooltip.
              (t("chat.shortcuts.title") ||
                (lang === "kz"
                  ? "Пернетақта қысқартулары"
                  : "Горячие клавиши")) + " (?)"
            }
          >
            <HelpCircle size={15} />
          </button>
        )}
        {!isEmpty && (
          <button
            onClick={onClearRequest}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-zinc-500 transition-colors hover:border-zinc-200 hover:bg-zinc-50 hover:text-zinc-700"
            // s35 wave 23a (2026-04-28): consequence-aware aria
            // mirroring the wave-22b ClearConfirmModal
            // destructive button. Visible tooltip stays the
            // bare verb so sighted hover users keep the tight
            // one-word label.
            aria-label={clearChatButtonAria(lang === "kz" ? "kz" : "ru")}
            title={lang === "kz" ? "Тазалау" : "Очистить"}
          >
            <Trash2 size={15} />
          </button>
        )}
        <span
          className="inline-flex h-8 max-w-[7.75rem] items-center gap-1.5 rounded-lg border border-amber-200/80 bg-amber-50/70 px-2.5 text-amber-900 shadow-[0_1px_2px_rgba(180,83,9,0.06)] sm:max-w-[11rem]"
          style={{ fontSize: 11, fontWeight: 700 }}
          title={billing.chatModel}
        >
          <Bot size={13} className="shrink-0" />
          <span className="truncate">{billing.chatModel}</span>
        </span>
        <span
          className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 shadow-[0_1px_2px_rgba(24,24,27,0.04)] ${
            nearLimit
              ? "border-amber-200 bg-amber-50 text-amber-700 samga-anim-usage-pulse"
              : "border-zinc-200 bg-zinc-50 text-zinc-600"
          }`}
          style={{ fontSize: 11, fontWeight: 600 }}
          // s35 wave 23a (2026-04-28): consequence-aware aria
          // for the daily-usage pill. Sighted users get the
          // amber chip + numeric "12/40"; AT users now get the
          // same warning ("близко к лимиту" / "лимит достигнут")
          // plus the named metric.
          role="status"
          aria-label={chatHeaderUsageAria({
            used: usedToday,
            limit: limitToday,
            lang: lang === "kz" ? "kz" : "ru",
          })}
        >
          <CircleGauge size={13} aria-hidden="true" />
          <span aria-hidden="true">
            {usedToday}/{limitToday}
          </span>
        </span>
      </div>
    </div>
  );
}
