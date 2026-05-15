import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import apiClient from "../../../api/client"; // Use the migrated api client
import {
  getRequiredUntSubjects,
  getSubjectMaxScore,
  isValidProfileSubjectPair,
  normalizeSubjectName,
} from "../../lib/subjectLabels";

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  is_admin?: boolean | null;
  role?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  target_university_id?: number | null;
  chosen_subjects?: string[] | null;
  language_preference?: "KZ" | "RU" | "EN" | null;
  target_majors?: string[] | null;
  target_universities?: number[] | null;
  last_test_results?: Record<string, number[]> | null;
  weakest_subject?: string | null;
  // s26 phase 7: persisted quota choice ("GENERAL" | "RURAL"). Used by
  // the chat layer so it doesn't have to re-ask on every "what are my
  // chances?" prompt.
  competition_quota?: string | null;
  onboarding_completed?: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  setUserFromServer: (nextUser: AuthUser) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

function saveToken(token: string): void {
  localStorage.setItem("access_token", token);
  localStorage.setItem("token", token);
}

function clearToken(): void {
  localStorage.removeItem("access_token");
  localStorage.removeItem("token");
}

function hasToken(): boolean {
  return Boolean(
    localStorage.getItem("access_token") || localStorage.getItem("token"),
  );
}

/**
 * FastAPI returns validation errors as `response.data.detail` — either
 * a string (custom `HTTPException(detail=...)`) or an array of pydantic
 * error objects ({msg, loc, type, ...}). Returns whichever the response
 * actually carried, or `undefined` on shape mismatch.
 */
function extractAxiosErrorDetail(
  err: unknown,
): string | ReadonlyArray<{ msg?: unknown }> | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const response = (err as { response?: unknown }).response;
  if (typeof response !== "object" || response === null) return undefined;
  const data = (response as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return undefined;
  const detail = (data as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail as ReadonlyArray<{ msg?: unknown }>;
  }
  return undefined;
}

/**
 * Convert a pydantic detail (string or array) into a single user-visible
 * message. Optional `transform` is applied per-`msg` for callers that
 * need to strip pydantic's "Value error, " prefix.
 */
function formatPydanticDetail(
  detail: string | ReadonlyArray<{ msg?: unknown }> | undefined,
  transform?: (raw: string) => string,
): string | undefined {
  if (typeof detail === "string") return detail;
  if (!Array.isArray(detail)) return undefined;
  const parts = detail
    .map((item) => {
      const raw = typeof item?.msg === "string" ? item.msg : "";
      return transform ? transform(raw) : raw;
    })
    .filter(Boolean);
  return parts.length > 0 ? parts.join("; ") : undefined;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    if (!hasToken()) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      const response = await apiClient.get("/users/me");
      setUser(response.data);
    } catch {
      clearToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = useCallback(
    async (email: string, password: string) => {
      const formData = new FormData();
      formData.append("username", email);
      formData.append("password", password);

      try {
        const response = await apiClient.post("/auth/token", formData, {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        });
        saveToken(response.data.access_token);
        await refreshUser();
      } catch (err: unknown) {
        const detail = extractAxiosErrorDetail(err);
        const message = formatPydanticDetail(detail);
        throw new Error(message || "Неверный email или пароль");
      }
    },
    [refreshUser],
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      try {
        const response = await apiClient.post("/auth/register", {
          name,
          email,
          password,
          language_preference:
            localStorage.getItem("samga_lang") === "kz" ? "KZ" : "RU",
        });
        saveToken(response.data.access_token);
        await refreshUser();
      } catch (err: unknown) {
        const detail = extractAxiosErrorDetail(err);
        // pydantic prefixes custom ValueError with "Value error, " — strip
        // it so the registration form surfaces a clean message.
        const message = formatPydanticDetail(detail, (raw) =>
          raw.replace(/^Value error,\s*/i, "").trim(),
        );
        throw new Error(message || "Registration failed");
      }
    },
    [refreshUser],
  );

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  const setUserFromServer = useCallback((nextUser: AuthUser) => {
    setUser(nextUser);
  }, []);

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      isAuthenticated: Boolean(user) && hasToken(),
      loading,
      login,
      register,
      logout,
      refreshUser,
      setUserFromServer,
    }),
    [user, loading, login, register, logout, refreshUser, setUserFromServer],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}

export function isUserOnboardingComplete(user: AuthUser | null): boolean {
  if (!user) return false;

  const subjects = (user.chosen_subjects || []).map(normalizeSubjectName);
  const results = user.last_test_results || {};
  const requiredSubjects = getRequiredUntSubjects(subjects);
  const hasRequiredProfileData =
    isValidProfileSubjectPair(subjects) &&
    Boolean(user.target_university_id) &&
    Boolean(
      user.weakest_subject &&
      subjects.includes(normalizeSubjectName(user.weakest_subject)),
    ) &&
    requiredSubjects.length === 5 &&
    requiredSubjects.every((subject) => {
      const scores = results[subject];
      const maxScore = getSubjectMaxScore(subject);
      return (
        Array.isArray(scores) &&
        scores.length >= 1 &&
        scores.length <= 5 &&
        scores.every(
          (score) => Number.isFinite(score) && score >= 0 && score <= maxScore,
        )
      );
    });

  if (typeof user.onboarding_completed === "boolean") {
    return user.onboarding_completed && hasRequiredProfileData;
  }

  return hasRequiredProfileData;
}

export function isSamgaAdminUser(user: AuthUser | null): boolean {
  if (!user) return false;
  // Admin status comes from the backend only. Earlier private builds also
  // consulted a build-time `VITE_RAG_ADMIN_EMAILS` allowlist; in a public
  // bundle that list ships to every visitor as recoverable plaintext, so
  // we trust `user.is_admin` / `user.role` exclusively.
  const role = String(user.role || "").toLocaleLowerCase();
  return user.is_admin === true || role === "admin" || role === "ops";
}
