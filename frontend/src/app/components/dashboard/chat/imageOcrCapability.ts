/**
 * v3.12 (F5, 2026-04-30) — chat-image OCR capability + client-side
 * pre-flight validation.
 *
 * Pure helpers consumed by `ImageUploadButton`. No DOM mutation, no
 * fetch. Server still re-validates everything server-side (see
 * `app.services.image_ocr` + `routers/chat.py:/chat/ocr`); these
 * helpers exist to fail fast and explain why before we burn an
 * upload + a vision token.
 *
 * Mirrors the BE allow-list / size cap exactly so a passing FE
 * check translates into a passing BE check.
 */

/** Allow-list. Mirrors `ALLOWED_OCR_IMAGE_TYPES` in
 *  `backend/app/services/image_ocr.py`. */
export const ALLOWED_OCR_IMAGE_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/jpg",
] as const;

/** 8 MiB. Pinned to the BE constant. */
export const MAX_OCR_IMAGE_BYTES = 8 * 1024 * 1024;

export type OcrPreflightReason =
  | "ok"
  | "bad-type"
  | "too-large"
  | "empty"
  | "no-file";

/** Pre-flight a File picked via <input type="file">. Pure: takes a
 *  shape-compatible value (so tests can pass a plain object) and
 *  returns the BE-aligned reason token. */
export function preflightOcrFile(file: unknown): OcrPreflightReason {
  if (!file || typeof file !== "object") return "no-file";
  const f = file as { type?: unknown; size?: unknown };
  if (typeof f.type !== "string" || f.type.length === 0) return "bad-type";
  const normalised = f.type.trim().toLowerCase();
  if (!ALLOWED_OCR_IMAGE_TYPES.includes(normalised)) return "bad-type";
  if (typeof f.size !== "number" || !Number.isFinite(f.size)) {
    return "too-large";
  }
  if (f.size <= 0) return "empty";
  if (f.size > MAX_OCR_IMAGE_BYTES) return "too-large";
  return "ok";
}

/** Detect whether the running browser exposes the FormData + File
 *  pair we need to upload. SSR / pre-Phase-A environments may not.
 *  Pure: takes the window in for testability. */
export function detectImageOcrCapability(
  win: unknown = typeof window === "undefined" ? null : window,
): boolean {
  if (!win || typeof win !== "object") return false;
  const w = win as Record<string, unknown>;
  return (
    typeof w["FormData"] === "function" &&
    typeof w["File"] === "function" &&
    typeof w["fetch"] === "function"
  );
}

/** Pre-flight error message resolver. RU/KZ. Mirrors the BE
 *  `ocr_error_message` so the FE toast and the server toast use the
 *  same copy when the same condition fires from either side. */
export function ocrPreflightMessage(
  reason: OcrPreflightReason,
  uiLang: unknown,
): string {
  const ru = uiLang !== "kz";
  if (reason === "ok") return "";
  if (reason === "bad-type") {
    return ru
      ? "Поддерживаются только JPEG и PNG."
      : "Тек JPEG және PNG қолдау табады.";
  }
  if (reason === "too-large") {
    const cap = MAX_OCR_IMAGE_BYTES / (1024 * 1024);
    return ru
      ? `Файл слишком большой. Максимум — ${cap} МБ.`
      : `Файл тым үлкен. Максимум — ${cap} МБ.`;
  }
  if (reason === "empty") {
    return ru ? "Файл пустой." : "Файл бос.";
  }
  // "no-file"
  return ru ? "Файл не выбран." : "Файл таңдалмаған.";
}

/** Locale tag fed to the BE `lang=` query param. The BE only
 *  accepts "ru" or "kz"; anything else collapses to "ru". */
export function ocrLangParam(uiLang: unknown): "ru" | "kz" {
  return uiLang === "kz" ? "kz" : "ru";
}
