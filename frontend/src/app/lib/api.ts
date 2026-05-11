export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

type ApiRequestOptions = RequestInit & {
  auth?: boolean;
};

export const API_BASE = import.meta.env.VITE_API_URL || "/api";

/** Build an absolute URL into the API namespace for `<img src>` / `<a href>`
 *  that can't go through `apiRequest`. Keeps the base in one place. */
export function apiUrl(path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${suffix}`;
}

function getToken(): string | null {
  return localStorage.getItem("access_token") || localStorage.getItem("token");
}

function clearAuthToken(): void {
  localStorage.removeItem("access_token");
  localStorage.removeItem("token");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOnboardingRequired(detail: unknown): boolean {
  if (!isObject(detail)) {
    return false;
  }
  const code = detail.code || detail.error;
  return code === "onboarding_required";
}

function redirectToOnboarding(): void {
  if (typeof window === "undefined") {
    return;
  }
  if (!window.location.pathname.startsWith("/dashboard/onboarding")) {
    window.location.assign("/dashboard/onboarding");
  }
}

function getLang(): string {
  return localStorage.getItem("samga_lang") || "ru";
}

async function parseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

export async function apiRequest<T = unknown>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { auth = true, headers, ...rest } = options;
  const token = auth ? getToken() : null;

  const response = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": getLang(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });

  const body = await parseBody(response);

  if (!response.ok) {
    if (response.status === 401) {
      clearAuthToken();
    }

    const detail =
      typeof body === "object" && body !== null && "detail" in body
        ? (body as { detail?: unknown }).detail
        : body;

    if (response.status === 428 && isOnboardingRequired(detail)) {
      redirectToOnboarding();
    }

    const message =
      typeof detail === "string"
        ? detail
        : `Request failed with status ${response.status}`;

    throw new ApiError(response.status, message, detail);
  }

  return body as T;
}

export function apiGet<T = unknown>(path: string, auth = true): Promise<T> {
  return apiRequest<T>(path, { method: "GET", auth });
}

export function apiPost<T = unknown>(
  path: string,
  data?: unknown,
  auth = true,
): Promise<T> {
  return apiRequest<T>(path, {
    method: "POST",
    body: data !== undefined ? JSON.stringify(data) : undefined,
    auth,
  });
}

export function apiPut<T = unknown>(
  path: string,
  data?: unknown,
  auth = true,
): Promise<T> {
  return apiRequest<T>(path, {
    method: "PUT",
    body: data !== undefined ? JSON.stringify(data) : undefined,
    auth,
  });
}

export function apiDelete<T = unknown>(path: string, auth = true): Promise<T> {
  return apiRequest<T>(path, { method: "DELETE", auth });
}

export function apiPatch<T = unknown>(
  path: string,
  data?: unknown,
  auth = true,
): Promise<T> {
  return apiRequest<T>(path, {
    method: "PATCH",
    body: data !== undefined ? JSON.stringify(data) : undefined,
    auth,
  });
}

/** Fetch a binary asset as a Blob with the auth token in the
 *  `Authorization` header (NOT in the URL). Used for things like the
 *  authenticated PDF stream so the JWT does not leak via browser history,
 *  server logs, or `Referer`. */
export async function apiBlob(
  path: string,
  options: { auth?: boolean; signal?: AbortSignal } = {},
): Promise<Blob> {
  const { auth = true, signal } = options;
  const token = auth ? getToken() : null;

  const response = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    signal,
    headers: {
      Accept: "*/*",
      "Accept-Language": getLang(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearAuthToken();
    }
    let detail: unknown = undefined;
    try {
      detail = await response.text();
    } catch {
      /* ignore */
    }
    throw new ApiError(
      response.status,
      `Request failed with status ${response.status}`,
      detail,
    );
  }

  return response.blob();
}

interface UpdateProfileRequest {
  language_preference?: "KZ" | "RU" | "EN";
  target_majors?: string[];
  target_universities?: number[];
}

export function updateProfile(data: UpdateProfileRequest): Promise<unknown> {
  return apiPut("/users/me", data);
}

interface ExamHistoryItem {
  id: number;
  subjects: string[];
  score: number;
  max_score: number;
  total_questions: number;
  submitted_at: string;
  time_taken_seconds: number;
}

export function getExamHistory(): Promise<ExamHistoryItem[]> {
  return apiGet<ExamHistoryItem[]>("/exam/history");
}
