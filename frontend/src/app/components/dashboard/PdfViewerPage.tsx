import {
  ArrowLeft,
  BookOpen,
  FileText,
  Hash,
  Library,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useLang } from "../LanguageContext";
import { apiBlob, apiGet } from "../../lib/api";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { subjectLabel } from "../../lib/subjectLabels";

interface LibraryBook {
  id: number;
  title: string;
  subject: string;
  grade?: number;
  file_name?: string;
  total_pages?: number;
  pages?: number;
  author?: string;
}

const copy = {
  ru: {
    back: "К библиотеке",
    fallbackTitle: "Учебник Samga",
    reader: "Samga Library",
    source: "Источник",
    trusted: "Официальный учебник в защищенном просмотре Samga",
    grade: "Класс",
    page: "Страница",
    totalPages: "Страниц",
    pages: "стр.",
    file: "Файл",
    subject: "Предмет",
    bookId: "ID учебника",
    loading: "Загружаем учебник...",
    notFound: "Учебник не найден",
    pdfTitle: "PDF учебника",
  },
  kz: {
    back: "Кітапханаға қайту",
    fallbackTitle: "Samga оқулығы",
    reader: "Samga Library",
    source: "Дереккөз",
    trusted: "Samga қорғалған қарауындағы ресми оқулық",
    grade: "Сынып",
    page: "Бет",
    totalPages: "Бет саны",
    pages: "бет",
    file: "Файл",
    subject: "Пән",
    bookId: "Оқулық ID",
    loading: "Оқулық жүктеліп жатыр...",
    notFound: "Оқулық табылмады",
    pdfTitle: "Оқулық PDF",
  },
};

function normalizeBooks(data: unknown): LibraryBook[] {
  if (Array.isArray(data)) {
    return data as LibraryBook[];
  }
  if (
    data &&
    typeof data === "object" &&
    Array.isArray((data as { books?: unknown }).books)
  ) {
    return (data as { books: LibraryBook[] }).books;
  }
  return [];
}

function normalizePage(value: string | null): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

// v4.22 (2026-05-08): clamp `?page=` against the book's known page
// count so `?page=9999` (or any out-of-range value) scrolls to the
// last real page instead of producing a #page= fragment that drops
// the reader at an invisible offset. Pure helper so the unit test
// can call it without rendering the component. Closes hunt-backlog
// item L3.
export function clampPageToBook(
  page: number | undefined,
  totalPages: number | undefined,
): number | undefined {
  if (page === undefined) {
    return undefined;
  }
  if (typeof totalPages === "number" && totalPages > 0 && page > totalPages) {
    return totalPages;
  }
  return page;
}

export function PdfViewerPage() {
  const { bookId } = useParams();
  const [searchParams] = useSearchParams();
  const { lang } = useLang();
  const t = copy[lang === "kz" ? "kz" : "ru"];
  const id = Number(bookId);
  const page = normalizePage(searchParams.get("page"));
  const [book, setBook] = useState<LibraryBook | null>(null);
  const [loading, setLoading] = useState(true);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string>("");
  const [pdfError, setPdfError] = useState<boolean>(false);

  useDocumentTitle(book ? `${book.title} - ${t.reader}` : t.reader);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const data = await apiGet<unknown>("/library/books");
        const found =
          normalizeBooks(data).find((item) => Number(item.id) === id) || null;
        if (!cancelled) {
          setBook(found);
        }
      } catch {
        if (!cancelled) {
          setBook(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  // Authenticated blob fetch keeps the JWT in the Authorization header
  // (F-14 fix — previously the token was leaking via ?token= in the iframe URL,
  // which exposed it to browser history, server access logs, and Referer).
  useEffect(() => {
    if (!Number.isFinite(id)) {
      setPdfBlobUrl("");
      setPdfError(false);
      return;
    }

    let cancelled = false;
    let createdUrl = "";
    const controller = new AbortController();

    void (async () => {
      try {
        setPdfError(false);
        const blob = await apiBlob(`/library/books/${id}/pdf`, {
          signal: controller.signal,
        });
        if (cancelled) {
          return;
        }
        createdUrl = URL.createObjectURL(blob);
        setPdfBlobUrl(createdUrl);
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setPdfBlobUrl("");
        setPdfError(true);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [id]);

  const pdfUrl = useMemo(() => {
    if (!pdfBlobUrl) {
      return "";
    }
    // The page anchor must live in the URL fragment so PDF.js / Chromium's
    // built-in viewer scrolls to that page. Fragments are not sent to the
    // server, so this leaks nothing. v4.22: clamp against the book's
    // total_pages so a deep-link like ?page=9999 lands on the final page
    // instead of producing a fragment the viewer silently ignores.
    const clamped = clampPageToBook(page, book?.total_pages || book?.pages);
    return clamped && clamped > 0
      ? `${pdfBlobUrl}#page=${clamped}`
      : pdfBlobUrl;
  }, [pdfBlobUrl, page, book?.total_pages, book?.pages]);

  const title = book?.title || t.fallbackTitle;
  const totalPages = book?.total_pages || book?.pages;
  const gradeLabel = book?.grade ? `${book.grade}` : "-";
  const pageLabel = page ? `${page}` : "-";
  const localizedSubject =
    subjectLabel(book?.subject, lang) || book?.subject || "-";

  if (!Number.isFinite(id)) {
    return (
      <ViewerShell>
        <EmptyState title={t.notFound} backLabel={t.back} />
      </ViewerShell>
    );
  }

  if (!loading && !book) {
    return (
      <ViewerShell>
        <EmptyState title={t.notFound} backLabel={t.back} />
      </ViewerShell>
    );
  }

  return (
    <ViewerShell>
      <section className="rounded-2xl border border-zinc-200 bg-white px-6 py-6 sm:px-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <Link
              to="/dashboard/library"
              className="mb-4 inline-flex h-11 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
              style={{ fontSize: 13, fontWeight: 700 }}
            >
              <ArrowLeft size={15} />
              {t.back}
            </Link>

            <div className="mb-3 flex flex-wrap gap-2">
              <HeroPill icon={<Library size={13} className="text-amber-700" />}>
                {t.reader}
              </HeroPill>
              {book?.grade ? (
                <HeroPill
                  icon={<BookOpen size={13} className="text-amber-700" />}
                >
                  {t.grade}: {book.grade}
                </HeroPill>
              ) : null}
              {totalPages ? (
                <HeroPill
                  icon={<FileText size={13} className="text-amber-700" />}
                >
                  {totalPages} {t.pages}
                </HeroPill>
              ) : null}
            </div>

            <h1
              className="max-w-4xl text-[24px] text-zinc-950 sm:text-[30px]"
              style={{ fontWeight: 760, lineHeight: 1.08 }}
            >
              {loading ? t.loading : title}
            </h1>
            <p
              className="mt-3 max-w-2xl text-[13px] text-zinc-600 sm:text-[14px]"
              style={{ lineHeight: 1.7 }}
            >
              {t.trusted}
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-3 lg:w-[430px]">
            <HeroStat label={t.subject} value={localizedSubject} />
            <HeroStat label={t.page} value={pageLabel} />
            <HeroStat
              label={t.totalPages}
              value={totalPages ? String(totalPages) : "-"}
            />
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
          {pdfUrl ? (
            <iframe
              src={pdfUrl}
              title={`${t.pdfTitle}: ${title}`}
              className="block h-[74dvh] min-h-[620px] w-full border-0 bg-white"
            />
          ) : pdfError ? (
            <EmptyState title={t.notFound} backLabel={t.back} />
          ) : (
            <div
              className="flex h-[74dvh] min-h-[620px] w-full items-center justify-center bg-white text-zinc-500"
              role="status"
              aria-live="polite"
              style={{ fontSize: 13, fontWeight: 600 }}
            >
              {t.loading}
            </div>
          )}
        </section>

        <div className="rounded-2xl border border-zinc-200 bg-white px-5 py-5 xl:sticky xl:top-0 xl:self-start">
          <div className="mb-4 flex items-center gap-2 text-zinc-900">
            <ShieldCheck size={16} className="text-amber-700" />
            <h2 style={{ fontSize: 15, fontWeight: 740 }}>{t.source}</h2>
          </div>

          <div className="space-y-2.5">
            <MetaRow icon={BookOpen} label={t.grade} value={gradeLabel} />
            <MetaRow icon={Hash} label={t.page} value={pageLabel} />
            <MetaRow
              icon={FileText}
              label={t.totalPages}
              value={totalPages ? String(totalPages) : "-"}
            />
            <MetaRow
              icon={Library}
              label={t.subject}
              value={localizedSubject}
            />
            <MetaRow
              icon={FileText}
              label={t.file}
              value={book?.file_name || "-"}
            />
            <MetaRow icon={Hash} label={t.bookId} value={String(id)} />
          </div>
        </div>
      </div>
    </ViewerShell>
  );
}

function ViewerShell({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-7xl space-y-6">{children}</div>;
}

function HeroPill({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-zinc-700"
      style={{ fontSize: 11, fontWeight: 700 }}
    >
      {icon}
      {children}
    </span>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
      <p
        className="text-zinc-500"
        style={{ fontSize: 11, fontWeight: 760, textTransform: "uppercase" }}
      >
        {label}
      </p>
      <p
        className="mt-2 text-zinc-900"
        style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.45 }}
      >
        {value}
      </p>
    </div>
  );
}

function EmptyState({
  title,
  backLabel,
}: {
  title: string;
  backLabel: string;
}) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center p-8 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500">
        <BookOpen size={24} />
      </div>
      <h1 className="text-zinc-900" style={{ fontSize: 16, fontWeight: 720 }}>
        {title}
      </h1>
      <Link
        to="/dashboard/library"
        className="mt-4 inline-flex h-11 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
        style={{ fontSize: 13, fontWeight: 700 }}
      >
        <ArrowLeft size={15} />
        {backLabel}
      </Link>
    </div>
  );
}

function MetaRow({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
      <div
        className="flex items-center gap-2 text-zinc-500"
        style={{ fontSize: 11, fontWeight: 760, textTransform: "uppercase" }}
      >
        <Icon size={13} />
        <span>{label}</span>
      </div>
      <p
        className="mt-2 break-words text-zinc-900"
        style={{ fontSize: 13, fontWeight: 680, lineHeight: 1.55 }}
      >
        {value}
      </p>
    </div>
  );
}

export default PdfViewerPage;
