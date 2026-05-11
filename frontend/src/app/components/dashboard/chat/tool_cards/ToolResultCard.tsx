/**
 * Phase B (s21, 2026-04-22): dispatcher that renders the right tool-result
 * card based on the `tool` discriminator.
 *
 * Why dispatch and not just render inline in AssistantMessage? Two reasons:
 *
 *   (1) AssistantMessage stays lean. The markdown / citation parser tree
 *       there is already complex enough without also knowing about four
 *       different data shapes.
 *   (2) Forward compatibility. Phase C will add more tools (stop-gen,
 *       model picker, maybe attachments). They'll fan out through this
 *       dispatcher so the assistant bubble doesn't need a new prop each
 *       time.
 *
 * Safety: if we see a `tool` we don't know about, the dispatcher returns
 * `null` rather than rendering garbage. This matches the "Phase B ships
 * components but backend has NOT started emitting them yet" contract —
 * an accidental early emission must not crash the chat.
 */

import { GrantChanceGauge } from "./GrantChanceGauge";
import { UniComparisonTable } from "./UniComparisonTable";
import { HistoricalThresholdSparkline } from "./HistoricalThresholdSparkline";
import { RecommendationList } from "./RecommendationList";
import {
  UserProfileCard,
  RecentMistakesCard,
  RecentTestAttemptsCard,
  PracticeSummaryCard,
  DreamUniProgressCard,
  ChatSummaryCard,
} from "./MemoryCards";
import type { ToolResult } from "./types";

interface Props {
  /** Already-parsed tool result. The caller is responsible for
   *  narrowing raw `MessagePart.result` to a known shape — we just
   *  pattern-match on the `tool` discriminator. */
  result: ToolResult;
}

export function ToolResultCard({ result }: Props) {
  try {
    switch (result.tool) {
      case "grant_chance":
        return <GrantChanceGauge data={result.data} />;
      case "compare_universities":
        return <UniComparisonTable data={result.data} />;
      case "historical_thresholds":
        return <HistoricalThresholdSparkline data={result.data} />;
      case "recommend_universities":
        return <RecommendationList data={result.data} />;
      // s24 memory tools
      case "user_profile":
        return <UserProfileCard data={result.data} />;
      case "recent_mistakes":
        return <RecentMistakesCard data={result.data} />;
      case "recent_test_attempts":
        return <RecentTestAttemptsCard data={result.data} />;
      case "practice_summary":
        return <PracticeSummaryCard data={result.data} />;
      case "dream_university_progress":
        return <DreamUniProgressCard data={result.data} />;
      case "chat_summary":
        return <ChatSummaryCard data={result.data} />;
      default: {
        // Exhaustiveness check: if a new ToolResult variant is added
        // without a case here, TS flags this line. In runtime we just
        // render nothing (hide the unknown card from the user).
        const _never: never = result;
        void _never;
        return null;
      }
    }
  } catch (err) {
    // Never let a card render error take down the whole assistant
    // message. If the payload shape is wrong, the card simply hides.
    if (import.meta.env?.DEV) {
      console.warn("[ToolResultCard] failed to render", err, result);
    }
    return null;
  }
}

export default ToolResultCard;
