import axios, {
  type AxiosError,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from "axios";
import axiosRetry from "axios-retry";
import i18n from "../i18n";
import { devLog } from "../services/devLog";

// Create axios instance - uses Vite proxy in dev, or VITE_API_URL in production
const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 30000, // 30 seconds
});

// Configure retry logic with exponential backoff
axiosRetry(apiClient, {
  retries: 3,
  retryDelay: (retryCount: number) => {
    const delay = Math.pow(2, retryCount - 1) * 1000; // 1s, 2s, 4s
    const jitter = Math.random() * 200; // 0-200ms jitter
    return delay + jitter;
  },
  retryCondition: (error: AxiosError) => {
    // Only retry GET requests
    if (error.config?.method?.toUpperCase() !== "GET") {
      return false;
    }
    // Retry on network errors or 5xx status codes
    const status = error.response?.status;
    return (
      axiosRetry.isNetworkOrIdempotentRequestError(error) ||
      (typeof status === "number" && status >= 500 && status < 600)
    );
  },
  onRetry: (
    retryCount: number,
    _error: AxiosError,
    requestConfig: AxiosRequestConfig,
  ) => {
    // DEV-only: every transient retry was logging the URL+method to
    // the prod console. Now silent in prod, surfaced under DEV.
    devLog(
      `Retry attempt ${retryCount} for ${requestConfig.method?.toUpperCase()} ${requestConfig.url}`,
    );
  },
});

// Request interceptor - Attach JWT token and language preference
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem("access_token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Add Accept-Language header based on current i18n language
    const currentLanguage = i18n.language || "ru";
    config.headers["Accept-Language"] = currentLanguage;

    return config;
  },
  (error: unknown) => {
    return Promise.reject(error);
  },
);

// Response interceptor - Handle 401 errors
apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      // Unauthorized - clear token and redirect to login
      localStorage.removeItem("access_token");
      localStorage.removeItem("token"); // Legacy support

      const protectedPrefixes = [
        "/dashboard",
        "/chat",
        "/exams",
        "/library",
        "/universities",
        "/profile",
        "/billing",
      ];
      const isProtectedPath = protectedPrefixes.some((prefix) =>
        window.location.pathname.startsWith(prefix),
      );

      if (isProtectedPath && window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  },
);

export default apiClient;
