/**
 * MCP Transports — stdio and SSE communication.
 */

import { spawn, type ChildProcess } from "child_process";

// ── JSON-RPC Types ──────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

// ── Transport Interface ─────────────────────────────────────────────

export interface McpTransport {
  /** Send a request and wait for a response. */
  send(request: JsonRpcRequest): Promise<JsonRpcResponse>;
  /** Send a notification (no response expected). */
  notify(notification: JsonRpcNotification): Promise<void>;
  /** Close the transport. */
  close(): Promise<void>;
  /** Whether the transport is connected. */
  isConnected(): boolean;
}

// ── Stdio Transport ─────────────────────────────────────────────────

export class StdioTransport implements McpTransport {
  private process: ChildProcess | null = null;
  private pending = new Map<number, {
    resolve: (res: JsonRpcResponse) => void;
    reject: (err: Error) => void;
  }>();
  private buffer = "";
  private connected = false;

  constructor(
    private command: string,
    private args: string[] = [],
    private env: Record<string, string> = {}
  ) {}

  async start(): Promise<void> {
    this.process = spawn(this.command, this.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...this.env },
    });

    this.connected = true;

    this.process.stdout?.on("data", (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.process.on("close", () => {
      this.connected = false;
      // Reject all pending requests
      for (const [, { reject }] of this.pending) {
        reject(new Error("MCP server process exited"));
      }
      this.pending.clear();
    });

    this.process.on("error", (err) => {
      this.connected = false;
      for (const [, { reject }] of this.pending) {
        reject(err);
      }
      this.pending.clear();
    });
  }

  private processBuffer(): void {
    // JSON-RPC messages are newline-delimited
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const msg = JSON.parse(trimmed) as JsonRpcResponse | JsonRpcNotification;
        if ("id" in msg && msg.id !== undefined) {
          const pending = this.pending.get(msg.id);
          if (pending) {
            this.pending.delete(msg.id);
            pending.resolve(msg as JsonRpcResponse);
          }
        }
        // Notifications from server are currently ignored
      } catch {
        // Invalid JSON — skip
      }
    }
  }

  async send(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.process?.stdin?.writable) {
      throw new Error("MCP transport not connected");
    }

    return new Promise((resolve, reject) => {
      this.pending.set(request.id, { resolve, reject });

      const timeout = setTimeout(() => {
        this.pending.delete(request.id);
        reject(new Error(`MCP request timeout: ${request.method}`));
      }, 30000);

      this.pending.set(request.id, {
        resolve: (res) => {
          clearTimeout(timeout);
          resolve(res);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      this.process!.stdin!.write(JSON.stringify(request) + "\n");
    });
  }

  async notify(notification: JsonRpcNotification): Promise<void> {
    if (!this.process?.stdin?.writable) {
      throw new Error("MCP transport not connected");
    }
    this.process.stdin.write(JSON.stringify(notification) + "\n");
  }

  async close(): Promise<void> {
    this.connected = false;
    if (this.process) {
      this.process.kill("SIGTERM");
      // Give it a moment to clean up, then force kill
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill("SIGKILL");
        }
      }, 5000);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}

// ── SSE Transport ───────────────────────────────────────────────────

export class SseTransport implements McpTransport {
  private pending = new Map<number, {
    resolve: (res: JsonRpcResponse) => void;
    reject: (err: Error) => void;
  }>();
  private connected = false;
  private abortController: AbortController | null = null;

  constructor(
    private url: string,
    private headers: Record<string, string> = {}
  ) {}

  async start(): Promise<void> {
    this.abortController = new AbortController();
    this.connected = true;

    // Start SSE listener
    this.listenForEvents().catch(() => {
      this.connected = false;
    });
  }

  private async listenForEvents(): Promise<void> {
    const response = await fetch(`${this.url}/events`, {
      headers: {
        Accept: "text/event-stream",
        ...this.headers,
      },
      signal: this.abortController?.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`SSE connection failed: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6)) as JsonRpcResponse;
            if ("id" in data && data.id !== undefined) {
              const pending = this.pending.get(data.id);
              if (pending) {
                this.pending.delete(data.id);
                pending.resolve(data);
              }
            }
          } catch {
            // Invalid JSON — skip
          }
        }
      }
    }
  }

  async send(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    return new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(request.id);
        reject(new Error(`MCP request timeout: ${request.method}`));
      }, 30000);

      this.pending.set(request.id, {
        resolve: (res) => {
          clearTimeout(timeout);
          resolve(res);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      try {
        const response = await fetch(this.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...this.headers,
          },
          body: JSON.stringify(request),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
      } catch (err) {
        this.pending.delete(request.id);
        clearTimeout(timeout);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async notify(notification: JsonRpcNotification): Promise<void> {
    await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.headers,
      },
      body: JSON.stringify(notification),
    });
  }

  async close(): Promise<void> {
    this.connected = false;
    this.abortController?.abort();
    for (const [, { reject }] of this.pending) {
      reject(new Error("Transport closed"));
    }
    this.pending.clear();
  }

  isConnected(): boolean {
    return this.connected;
  }
}
