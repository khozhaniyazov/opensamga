/**
 * v3.12 (F5, 2026-04-30) — image upload → OCR → composer seed.
 *
 * Mounted in ChatComposer's footer next to the voice mic. Hidden when:
 *   1. The browser lacks FormData/File/fetch (SSR or pre-Phase-A
 *      environments) — see imageOcrCapability.detectImageOcrCapability.
 *   2. The feature flag VITE_FEATURE_IMAGE_OCR isn't truthy.
 *
 * Default OFF. Flip to "true" in `.env.local` to enable in dev. The
 * BE endpoint at `/api/chat/ocr` is always wired — the flag only
 * controls the FE entrypoint.
 *
 * Behaviour: tap → file picker → upload → seed composer with
 * `<RU/KZ prefix>\n\n<OCR'd text>`. Pre-flight rejects bad MIME /
 * oversized files locally so we don't burn an upload + a vision
 * token on something the BE will refuse.
 */

import { useRef, useState } from "react";
import { ImageUp, Loader2 } from "lucide-react";
import { useLang } from "../../LanguageContext";
import {
  ALLOWED_OCR_IMAGE_TYPES,
  detectImageOcrCapability,
  ocrLangParam,
  ocrPreflightMessage,
  preflightOcrFile,
} from "./imageOcrCapability";

interface Props {
  /** Called with the composer-ready seed string when OCR succeeds.
   *  Caller decides whether to overwrite or append to the draft. */
  onSeed: (seedText: string) => void;
  /** Called with a localized error string on any failure. Caller
   *  routes this through whatever toast / announcer surface they
   *  already use (we don't pull in a Toast provider here). */
  onError: (message: string) => void;
  /** Hide while assistant is streaming so we don't race a live turn. */
  disabled?: boolean;
}

const FEATURE_FLAG = (() => {
  try {
    const env = (import.meta as unknown as { env?: Record<string, unknown> })
      .env;
    const v = env?.["VITE_FEATURE_IMAGE_OCR"];
    return v === "true" || v === true;
  } catch {
    return false;
  }
})();

interface OcrResponse {
  transcribed?: unknown;
  classification?: unknown;
  seed_text?: unknown;
  error_message?: unknown;
}

export function ImageUploadButton({
  onSeed,
  onError,
  disabled = false,
}: Props) {
  const { lang } = useLang();
  const langSafe: "ru" | "kz" = lang === "kz" ? "kz" : "ru";
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  // Capability + flag gating. Hide entirely so the row stays clean.
  if (!FEATURE_FLAG) return null;
  if (!detectImageOcrCapability()) return null;

  const handlePick = () => {
    if (disabled || busy) return;
    inputRef.current?.click();
  };

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    // Reset the input value so picking the same file twice still
    // fires onChange (the default behaviour suppresses identical
    // selections — annoying for retry-after-error flows).
    e.target.value = "";

    if (!file) return;

    const reason = preflightOcrFile(file);
    if (reason !== "ok") {
      onError(ocrPreflightMessage(reason, langSafe));
      return;
    }

    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const url = `/api/chat/ocr?lang=${ocrLangParam(langSafe)}`;
      const resp = await fetch(url, {
        method: "POST",
        body: fd,
        credentials: "include",
      });

      // Try to parse the body either way — both 200 and 4xx/5xx may
      // carry a localized `detail` message.
      let body: OcrResponse | { detail?: unknown } | null = null;
      try {
        body = (await resp.json()) as OcrResponse | { detail?: unknown };
      } catch {
        body = null;
      }

      if (!resp.ok) {
        const detail =
          body && typeof (body as { detail?: unknown }).detail === "string"
            ? ((body as { detail: string }).detail as string)
            : ocrPreflightMessage("no-file", langSafe); // generic fallback
        onError(detail);
        return;
      }

      const data = (body ?? {}) as OcrResponse;
      const seedText =
        typeof data.seed_text === "string" ? data.seed_text : null;
      if (seedText && seedText.length > 0) {
        onSeed(seedText);
        return;
      }

      // 200 + classification != "ok": surface the localized message.
      const errMsg =
        typeof data.error_message === "string" && data.error_message.length > 0
          ? data.error_message
          : ocrPreflightMessage("empty", langSafe);
      onError(errMsg);
    } catch {
      onError(
        langSafe === "kz"
          ? "Тану уақытша қолжетімсіз. Кейінірек көріңіз."
          : "Распознавание временно недоступно. Попробуйте позже.",
      );
    } finally {
      setBusy(false);
    }
  };

  const aria =
    langSafe === "kz" ? "Сұрақ суретін жүктеу" : "Загрузить фото с вопросом";

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_OCR_IMAGE_TYPES.join(",")}
        onChange={handleChange}
        className="hidden"
        aria-hidden
        tabIndex={-1}
      />
      <button
        type="button"
        onClick={handlePick}
        disabled={disabled || busy}
        aria-label={aria}
        title={aria}
        className={
          "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-all duration-200 " +
          (busy
            ? "bg-zinc-50 text-zinc-400"
            : "bg-white text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-50") +
          " disabled:opacity-50"
        }
      >
        {busy ? (
          <Loader2 size={16} className="animate-spin" aria-hidden />
        ) : (
          <ImageUp size={16} aria-hidden />
        )}
      </button>
    </>
  );
}

export { FEATURE_FLAG as IMAGE_OCR_FEATURE_FLAG };
