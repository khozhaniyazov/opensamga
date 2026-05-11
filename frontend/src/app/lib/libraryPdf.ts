import { apiUrl } from "./api";

function getAccessToken(): string | null {
  try {
    return (
      localStorage.getItem("access_token") || localStorage.getItem("token")
    );
  } catch {
    return null;
  }
}

export function withApiAccessToken(path: string): string {
  const token = getAccessToken();
  const url = apiUrl(path);

  if (!token) {
    return url;
  }

  const hashIndex = url.indexOf("#");
  const base = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const fragment = hashIndex >= 0 ? url.slice(hashIndex) : "";
  const separator = base.includes("?") ? "&" : "?";

  return `${base}${separator}token=${encodeURIComponent(token)}${fragment}`;
}

export function buildLibraryPdfApiUrl(bookId: number, page?: number): string {
  const pageFragment = page && page > 0 ? `#page=${page}` : "";
  return withApiAccessToken(`/library/books/${bookId}/pdf${pageFragment}`);
}

export function buildLibraryThumbnailApiUrl(
  bookId: number,
  page: number,
  width = 360,
): string {
  return withApiAccessToken(
    `/library/books/${bookId}/pages/${page}/thumbnail?w=${width}`,
  );
}

export function buildLibraryPdfViewerPath(
  bookId: number,
  page?: number,
): string {
  const search = page && page > 0 ? `?page=${page}` : "";
  return `/dashboard/library/books/${bookId}${search}`;
}
