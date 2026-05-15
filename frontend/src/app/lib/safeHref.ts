/**
 * Returns the input URL only when it is a safe http(s) absolute URL or a
 * mailto:/tel: link; otherwise returns `undefined`. Intended for any
 * `<a href={…}>` whose value comes from BE rows or tool-card output, where
 * a `javascript:` or `data:text/html,…` value would otherwise become a
 * one-click XSS / open-redirect.
 *
 * Round-2 audit (2026-05-15): closes the unvalidated-website hrefs on
 * `UniversitiesPage`, `UniComparisonTable`, and friends.
 */
export function safeHttpHref(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  // Allow same-page anchors and absolute paths verbatim — they cannot
  // navigate to a new origin.
  if (trimmed.startsWith("#") || trimmed.startsWith("/")) return trimmed;

  try {
    const url = new URL(trimmed);
    const proto = url.protocol;
    if (proto === "http:" || proto === "https:" || proto === "mailto:" || proto === "tel:") {
      return url.toString();
    }
    return undefined;
  } catch {
    // Bare hostnames like `kazguu.kz` parse fail under the URL ctor; treat
    // them as relative-but-likely-an-https-link and prepend the scheme.
    if (/^[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(trimmed)) {
      return `https://${trimmed}`;
    }
    return undefined;
  }
}
