import { lazy, ComponentType } from "react";

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 3000];

type LazyModule<T extends ComponentType<any>> =
  | { default: T }
  | Record<string, unknown>;

function normalizeLazyModule<T extends ComponentType<any>>(
  module: LazyModule<T>,
): { default: T } {
  if (
    "default" in module &&
    typeof (module as { default: unknown }).default === "function"
  ) {
    return { default: (module as { default: T }).default };
  }

  const componentExport = Object.values(module).find(
    (value): value is T => typeof value === "function",
  ) as T | undefined;

  if (!componentExport) {
    throw new Error("Lazy-loaded module does not export a React component");
  }

  return { default: componentExport };
}

export function lazyRetry<T extends ComponentType<any>>(
  importFunc: () => Promise<LazyModule<T>>,
) {
  return lazy(async () => {
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        const result = await importFunc();
        sessionStorage.removeItem("retry-refreshed");
        return normalizeLazyModule(result);
      } catch (error) {
        const isLastAttempt = i === MAX_RETRIES - 1;

        if (isLastAttempt) {
          const hasRefreshed =
            sessionStorage.getItem("retry-refreshed") === "true";
          if (!hasRefreshed) {
            sessionStorage.setItem("retry-refreshed", "true");
            window.location.reload();
            return new Promise(() => {});
          }
          sessionStorage.removeItem("retry-refreshed");
          throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[i]));
      }
    }

    throw new Error("Failed to load component");
  });
}
