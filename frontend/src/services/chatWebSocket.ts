/**
 * WebSocket client for streaming AI chat responses
 * Handles connection management, reconnection logic, and message streaming
 */

import { devError, devLog } from "./devLog";

export interface ChatWebSocketHandlers {
  onChunk: (content: string) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
}

interface IncomingFrame {
  type: "chunk" | "done" | "error" | string;
  content?: string;
  message?: string;
}

function toWebSocketProtocol(protocol: string): string {
  return protocol === "https:" ? "wss:" : "ws:";
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function resolveWebSocketUrl(token: string): string {
  const configuredWsBase = import.meta.env.VITE_WS_URL as string | undefined;
  const configuredApiBase =
    (import.meta.env.VITE_API_URL as string | undefined) || "/api";
  const source = configuredWsBase || configuredApiBase;
  const url = new URL(source, window.location.origin);

  url.protocol = toWebSocketProtocol(url.protocol);
  url.pathname = trimTrailingSlash(url.pathname);

  if (!url.pathname.endsWith("/ws/chat")) {
    url.pathname = `${url.pathname}/ws/chat`.replace(/\/{2,}/g, "/");
  }

  url.searchParams.set("token", token);
  return url.toString();
}

export class ChatWebSocket {
  private token: string;
  private onChunk: (content: string) => void;
  private onComplete: () => void;
  private onError: (error: Error) => void;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // Start with 1 second

  constructor(token: string, handlers: ChatWebSocketHandlers) {
    this.token = token;
    this.onChunk = handlers.onChunk;
    this.onComplete = handlers.onComplete;
    this.onError = handlers.onError;
  }

  /**
   * Connect to WebSocket server
   * @returns True if connected successfully
   */
  async connect(): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      try {
        const wsUrl = resolveWebSocketUrl(this.token);
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          devLog("WebSocket connected");
          this.reconnectAttempts = 0;
          this.reconnectDelay = 1000;
          resolve(true);
        };

        this.ws.onmessage = (event: MessageEvent) => {
          try {
            const data: IncomingFrame = JSON.parse(event.data);

            if (data.type === "chunk") {
              this.onChunk(data.content ?? "");
            } else if (data.type === "done") {
              this.onComplete();
            } else if (data.type === "error") {
              this.onError(new Error(data.message || "Unknown error"));
            }
          } catch (err) {
            devError("Error parsing WebSocket message:", err);
          }
        };

        this.ws.onerror = (error: Event) => {
          devError("WebSocket error:", error);
          reject(new Error("WebSocket connection failed"));
        };

        this.ws.onclose = (event: CloseEvent) => {
          devLog("WebSocket closed:", event.code, event.reason);

          // Attempt reconnection if not closed intentionally
          if (
            event.code !== 1000 &&
            this.reconnectAttempts < this.maxReconnectAttempts
          ) {
            this.attemptReconnect();
          }
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  async attemptReconnect(): Promise<void> {
    this.reconnectAttempts++;
    devLog(
      `Reconnecting... Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`,
    );

    setTimeout(async () => {
      try {
        await this.connect();
      } catch (err) {
        devError("Reconnection failed:", err);

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          this.onError(
            new Error("Failed to reconnect after multiple attempts"),
          );
        }
      }
    }, this.reconnectDelay);

    // Exponential backoff (1s, 2s, 4s, 8s, max 10s)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10000);
  }

  /**
   * Send a message to the server
   * @param content - Message content
   * @param language - Language code (ru/kz)
   */
  async sendMessage(content: string, language: string = "ru"): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }

    this.ws.send(
      JSON.stringify({
        type: "message",
        content,
        language,
      }),
    );
  }

  /**
   * Close the WebSocket connection
   */
  close(): void {
    if (this.ws) {
      this.ws.close(1000, "Client closed connection");
      this.ws = null;
    }
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

/**
 * Helper function to check if WebSocket is supported
 */
export function isWebSocketSupported(): boolean {
  return "WebSocket" in window || "MozWebSocket" in window;
}
