import apiClient from "../api/client";
import type { ChatEnvelope } from "../app/components/dashboard/chat/types";
import { devError } from "./devLog";

export interface SendMessageOptions {
  signal?: AbortSignal;
  threadId?: number | string | null;
}

interface ChatPayloadMessage {
  role: string;
  content: string;
  [key: string]: unknown;
}

export const sendMessage = async (
  messages: ChatPayloadMessage[],
  userScore: number | null = null,
  userQuota: string = "GENERAL",
  language: string = "ru",
  options: SendMessageOptions = {},
): Promise<ChatEnvelope> => {
  // Phase C (s22): optional AbortSignal so the chat UI can cancel an
  // in-flight request when the user hits the stop button. axios v0.27+
  // honours `signal` like fetch — aborted requests raise a
  // CanceledError which the caller should treat as user-initiated.
  //
  // s22 (BUG-S22-sidebar): optional `threadId` routes the turn into a
  // specific chat_threads row so the left-rail sidebar can keep each
  // Samga Chat conversation separate. null/undefined = legacy
  // "Main chat" bucket.
  const { signal, threadId } = options;
  try {
    // Session 22 (2026-04-22): the REST chat path can take 60–90s
    // because it runs retrieval + tool-calling + full answer
    // generation on the premium tier. The default apiClient 30s
    // timeout was firing mid-answer and leaving the user with a
    // "Попробуйте ещё раз" bubble even though the backend produced
    // a valid reply. Give the chat endpoint a dedicated 180s budget
    // while leaving all other endpoints at 30s.
    const response = await apiClient.post<ChatEnvelope>(
      "/chat",
      {
        messages,
        user_score: userScore,
        user_quota: userQuota,
        language,
        ...(threadId !== null && threadId !== undefined
          ? { thread_id: threadId }
          : {}),
      },
      {
        timeout: 180000,
        ...(signal ? { signal } : {}),
      },
    );
    return response.data;
  } catch (error: unknown) {
    // Don't spam the console with user-initiated cancellations.
    const err = error as { name?: string; code?: string } | null;
    const isAbort =
      err?.name === "CanceledError" ||
      err?.code === "ERR_CANCELED" ||
      err?.name === "AbortError";
    if (!isAbort) {
      devError("Error sending message:", error);
    }
    throw error;
  }
};

export const getChatHistory = async (): Promise<unknown[]> => {
  try {
    const response = await apiClient.get<{ messages?: unknown[] }>(
      "/chat/history",
    );
    return response.data.messages || [];
  } catch (error) {
    devError("Error fetching chat history:", error);
    return [];
  }
};

export const clearChatHistory = async (): Promise<unknown> => {
  try {
    const response = await apiClient.delete("/chat/history");
    return response.data;
  } catch (error) {
    devError("Error clearing chat history:", error);
    throw error;
  }
};

export const exportChatHistory = async (
  format: string = "json",
): Promise<boolean> => {
  try {
    const response = await apiClient.get("/chat/history/export", {
      params: { format },
      responseType: "blob",
    });

    // Создаем ссылку для скачивания
    const url = window.URL.createObjectURL(new Blob([response.data as Blob]));
    const link = document.createElement("a");
    link.href = url;
    const contentDisposition = response.headers["content-disposition"];
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename="(.+)"/);
      if (filenameMatch) {
        link.setAttribute("download", filenameMatch[1]);
      }
    } else {
      link.setAttribute("download", `chat_history.${format}`);
    }
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);

    return true;
  } catch (error) {
    devError("Error exporting chat history:", error);
    throw error;
  }
};

export const searchChatHistory = async (
  query: string,
): Promise<{ messages: unknown[]; query: string; count: number }> => {
  try {
    const response = await apiClient.get<{
      messages: unknown[];
      query: string;
      count: number;
    }>("/chat/history/search", {
      params: { q: query },
    });
    return response.data;
  } catch (error) {
    devError("Error searching chat history:", error);
    return { messages: [], query, count: 0 };
  }
};

export const getAnalyticsReport = async (
  uniName: string,
  majorCode: string,
  quotaType: string = "GENERAL",
): Promise<unknown> => {
  try {
    const response = await apiClient.get("/analytics/report", {
      params: {
        uni_name: uniName,
        major_code: majorCode,
        quota_type: quotaType,
      },
    });
    return response.data;
  } catch (error) {
    devError("Error fetching analytics report:", error);
    throw error;
  }
};
