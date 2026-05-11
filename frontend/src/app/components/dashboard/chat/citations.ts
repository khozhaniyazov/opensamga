/**
 * Citation parser for assistant messages.
 *
 * Recognises the three shapes Samga's tutor emits (per prompts.py / chat.py):
 *   📚 *Source: <Book Title>, Page <N>*
 *   📚 *Источник: <Subject> - <Book Title> (Grade X), Страница <N>*
 *   📚 *Дереккөз: <Subject> - <Book Title> (Grade X), Бет <N>*
 *
 * Returns an array of `Segment`s that alternate between `text` (plain markdown)
 * and `citation` (structured book/page) so the renderer can splice chips into
 * the stream without mangling the surrounding markdown.
 */

export interface Citation {
  bookName: string;
  pageNumber: number;
  /** Phase A (s20c): backend-supplied structured hint. When present the
   *  renderer MUST prefer this id over fuzzy-matching `bookName` against
   *  the library catalogue — it comes straight from the retrieval layer
   *  and eliminates the "Algebra 10 vs Algebra 11" mis-attribution bug. */
  bookId?: number | null;
}

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "citation"; citation: Citation };

/** HTML-comment hint emitted by `apply_library_outcome_markers` when the
 *  backend knows exactly which book+page served the turn. Shape:
 *
 *      <!-- samga-citation book_id=21 page=142 -->
 *
 *  We strip these from the rendered markdown (ReactMarkdown already elides
 *  HTML comments, but we also want the structured data). */
const SAMGA_HINT_RE =
  /<!--\s*samga-citation\s+book_id=(\d+)\s+page=(\d+)\s*-->/gi;

interface SamgaHint {
  bookId: number;
  pageNumber: number;
}

function extractSamgaHints(text: string): {
  cleaned: string;
  hints: SamgaHint[];
} {
  const hints: SamgaHint[] = [];
  const cleaned = text.replace(SAMGA_HINT_RE, (_m, bid, pg) => {
    const bookId = parseInt(bid, 10);
    const pageNumber = parseInt(pg, 10);
    if (Number.isFinite(bookId) && Number.isFinite(pageNumber)) {
      hints.push({ bookId, pageNumber });
    }
    return "";
  });
  return { cleaned, hints };
}

/**
 * F-10: Strip tail noise like ` – 72*` or ` — 184*` that the model
 * occasionally leaves behind when it starts to emit a citation marker
 * (`📚 *Source: ..., Page 72*`) but never closes it cleanly. The full
 * citation regex already handles the well-formed case; this is the
 * safety net for the malformed tail.
 *
 * Examples observed live:
 *   "...интеграл от 0 до 1.\n\n– 72*"
 *   "ответ: 4 –72*"
 *
 * We only strip when the orphan number+`*` is at the very end of the
 * message (`$`), so legitimate prose like "x – 72 шагов" is untouched.
 */
const CITATION_DEBRIS_RE = /[\s\u00A0]*[-–—][\s\u00A0]*\d+\s*\*+[\s\u00A0]*$/u;

export function stripCitationDebris(text: string): string {
  if (!text) return text;
  return text.replace(CITATION_DEBRIS_RE, "");
}

interface RawMatch {
  start: number;
  end: number;
  bookName: string;
  pageNumber: number;
}

// The backend (prompts.py + apply_library_outcome_markers) composes the
// citation as `📚 *{LABEL}: {Book Title} (Grade N), Page M*` — but the LLM
// reformats it all over the place. Shapes observed live on 2026-04-18:
//   📚 *Источник: Математика - ... (Grade 4), Page 101*
//   📚 Источник:*Chemistry 11 Part 1 (Grade 11), Страница 184*    ← no space, split *s
//   📚 **Источник:** *Chemistry ..., Page 55*
//   📚 *Source: Physics 9, Page 12*
// So we tolerate any mix of `*` and whitespace around the label and body,
// and accept Page / Страница / Бет interchangeably.
const PAGE_WORDS = "(?:Page|Страница|Бет)";
const LABEL_WORDS = "(?:Source|Источник|Дереккөз)";

// The inner body must contain at least one non-`*` non-newline char and
// end before a page word. We strip wrapping `*` in `cleanBookName`.
const CITATION_PATTERNS: RegExp[] = [
  // 📚-anchored — the canonical case.
  new RegExp(
    `📚\\s*[*]{0,2}\\s*${LABEL_WORDS}\\s*:?\\s*[*]{0,2}\\s*` +
      `([^\\n]+?)` +
      `\\s*[,\\s]\\s*${PAGE_WORDS}\\s*(\\d+)\\s*[*]{0,2}`,
    "giu",
  ),
  // Fallback for paraphrases without 📚 — require word boundary so we don't
  // eat accidental prose containing the word "Source:".
  new RegExp(
    `(?<![\\w])[*]{0,2}\\s*${LABEL_WORDS}\\s*:\\s*[*]{0,2}\\s*` +
      `([^\\n]+?)` +
      `\\s*[,\\s]\\s*${PAGE_WORDS}\\s*(\\d+)\\s*[*]{0,2}`,
    "giu",
  ),
];

/** Collapse whitespace / drop leading "- " / subject-prefix noise. */
function cleanBookName(raw: string): string {
  let name = raw.replace(/\s+/g, " ").trim();
  // Strip wrapping `*` / `**` that leaks from markdown bold runs like
  //   "📚 **Источник:** *Chemistry..." → body captured as "*Chemistry..."
  name = name.replace(/^\*+/, "").replace(/\*+$/, "").trim();
  // Strip leading "- " that the RU/KZ multi-line format injects
  name = name.replace(/^-+\s*/, "");
  // Backend composes `"{subject} - {title}"`. When the ingestion pipeline
  // has already baked the subject into the title (e.g. title="History of
  // Kazakhstan 10", subject="History of Kazakhstan"), the result is
  // "History of Kazakhstan - History of Kazakhstan 10". Collapse that.
  // Tolerate hyphen, en-dash (–), em-dash (—), and extra whitespace.
  const dupMatch = name.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (dupMatch && dupMatch[1] && dupMatch[2]) {
    const prefix = dupMatch[1].trim();
    const rest = dupMatch[2].trim();
    if (prefix && rest.toLowerCase().startsWith(prefix.toLowerCase())) {
      name = rest;
    }
  }
  // Strip trailing grade markers which are redundant with the `· N класс` tail.
  // Both parenthesised "(Grade 10)" and trailing ", Grade 10" / " Grade 10".
  name = name.replace(/\s*[,·]?\s*\(?Grade\s*\d+\)?\s*$/i, "");
  name = name.replace(/\s*\(\d+\s*класс\)\s*$/i, "");
  name = name.replace(/\s*\(\d+\s*сынып\)\s*$/i, "");
  return name.trim();
}

export function parseCitationSegments(text: string): Segment[] {
  if (!text) return [{ kind: "text", text: text ?? "" }];

  // Phase A (s20c): pull out the backend hint BEFORE parsing citations so
  // the cleaned text is what the renderer sees (no visible comment in the
  // markdown for users who somehow end up with raw HTML rendering on).
  const { cleaned: text_clean, hints } = extractSamgaHints(text);
  const srcText = text_clean;

  const matches: RawMatch[] = [];
  for (const pat of CITATION_PATTERNS) {
    const re = new RegExp(pat.source, pat.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(srcText)) !== null) {
      const bookName = cleanBookName(m[1] ?? "");
      const pageNumber = parseInt(m[2] ?? "", 10);
      if (!bookName || !Number.isFinite(pageNumber)) continue;
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        bookName,
        pageNumber,
      });
    }
  }

  if (matches.length === 0) return [{ kind: "text", text: srcText }];

  // Sort by start; drop overlaps (keep the first).
  matches.sort((a, b) => a.start - b.start);
  const kept: RawMatch[] = [];
  let cursor = -1;
  for (const m of matches) {
    if (m.start >= cursor) {
      kept.push(m);
      cursor = m.end;
    }
  }

  // Dedupe consecutive identical citations (same book + page within a short
  // window) — sometimes the tutor restates the marker across paragraphs.
  const deduped: RawMatch[] = [];
  for (const m of kept) {
    const prev = deduped[deduped.length - 1];
    if (
      prev &&
      prev.bookName.toLowerCase() === m.bookName.toLowerCase() &&
      prev.pageNumber === m.pageNumber &&
      m.start - prev.end < 200
    ) {
      continue;
    }
    deduped.push(m);
  }

  const segments: Segment[] = [];
  let pos = 0;
  for (const m of deduped) {
    if (m.start > pos) {
      segments.push({ kind: "text", text: srcText.slice(pos, m.start) });
    }
    // Phase A (s20c): attach backend hint when we have one with a matching
    // page_number. We intentionally match by page (not by ordinal index) —
    // the LLM sometimes echoes the prose marker twice or in a different
    // order from the backend's retrieval ranking.
    const hintForPage = hints.find((h) => h.pageNumber === m.pageNumber);
    segments.push({
      kind: "citation",
      citation: {
        bookName: m.bookName,
        pageNumber: m.pageNumber,
        bookId: hintForPage ? hintForPage.bookId : null,
      },
    });
    pos = m.end;
  }
  if (pos < srcText.length) {
    segments.push({ kind: "text", text: srcText.slice(pos) });
  }

  // Collapse obvious whitespace noise left by stripped markers (e.g. "\n\n\n").
  return segments.map((seg) =>
    seg.kind === "text"
      ? { kind: "text", text: seg.text.replace(/\n{3,}/g, "\n\n") }
      : seg,
  );
}

// ---------------------------------------------------------------------------
// Book-id resolver
// ---------------------------------------------------------------------------

export interface BookRef {
  id: number;
  title: string;
  grade?: number | null;
  subject?: string | null;
}

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Match a citation's free-form `bookName` (which may include subject prefix
 * and grade) against the library's book list. Returns the first plausible id.
 */
export function resolveBookId(
  bookName: string,
  books: BookRef[],
): number | null {
  if (!bookName || !books || books.length === 0) return null;

  // The RU/KZ tutor formats as "Subject - Book Title". Produce candidates for
  // both the full string and the part after " - " / " — " so either half can
  // match a DB title.
  const full = normalize(bookName);
  const candidates: string[] = [full];
  const splitMatch = full.split(/\s+[-–—]\s+/);
  if (splitMatch.length > 1) {
    candidates.push(splitMatch.slice(1).join(" - ").trim());
    const tail = splitMatch[splitMatch.length - 1];
    if (tail) candidates.push(tail.trim());
  }

  // Helper: word tokens weighted by length (digits + short words ignored).
  const titleTokensCache = new Map<number, string[]>();
  const titleTokens = (b: BookRef): string[] => {
    let t = titleTokensCache.get(b.id);
    if (!t) {
      t = tokenize(normalize(b.title));
      titleTokensCache.set(b.id, t);
    }
    return t;
  };

  // Helper: does needle include a specific grade number? If so, we prefer
  // books whose title carries the same grade.
  const gradeInNeedle =
    /(?:^|\s)(7|8|9|10|11)(?:\s|$|класс|сынып|кл\.|cl\.)/i.exec(full);
  const preferredGrade =
    gradeInNeedle && gradeInNeedle[1] ? parseInt(gradeInNeedle[1], 10) : null;

  for (const needle of candidates) {
    if (!needle) continue;

    // 1. Exact title match
    let hit = books.find((b) => normalize(b.title) === needle);
    if (hit) return hit.id;

    // 2. Title ⊂ needle (e.g. needle "математика - алгебра 10 класс" ⊇ title)
    hit = books.find((b) => {
      const t = normalize(b.title);
      return t.length >= 4 && needle.includes(t);
    });
    if (hit) return hit.id;

    // 3. Needle ⊂ title
    hit = books.find((b) => {
      const t = normalize(b.title);
      return needle.length >= 4 && t.includes(needle);
    });
    if (hit) return hit.id;
  }

  // 4. Token overlap across candidates. Score by overlap count; require ≥ 1
  //    overlapping significant token AND (a) grade-match OR (b) unique best.
  const needleTokens = Array.from(
    new Set(candidates.flatMap((c) => tokenize(c))),
  );
  if (needleTokens.length === 0) return null;

  let best: { id: number; score: number; gradeMatch: boolean } | null = null;
  for (const b of books) {
    const tTokens = titleTokens(b);
    let score = 0;
    for (const tok of tTokens) {
      if (needleTokens.includes(tok)) score += 1;
    }
    if (score === 0) continue;
    const gradeMatch =
      preferredGrade !== null && b.grade != null && b.grade === preferredGrade;
    if (
      best === null ||
      score > best.score ||
      (score === best.score && gradeMatch && !best.gradeMatch)
    ) {
      best = { id: b.id, score, gradeMatch };
    }
  }
  if (best && (best.score >= 2 || best.gradeMatch)) return best.id;

  return null;
}

function tokenize(s: string): string[] {
  return s
    .split(/[\s\-–—,()]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t));
}
