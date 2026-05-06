"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface UseSandboxOptions {
  runtime?: "node" | "python" | "bash";
  autoCreate?: boolean;
}

interface SandboxState {
  sessionId: string | null;
  isBooting: boolean;
  isReady: boolean;
  error: string | null;
}

export function useSandbox(options: UseSandboxOptions = {}) {
  const { runtime = "node", autoCreate = false } = options;
  const [state, setState] = useState<SandboxState>({
    sessionId: null,
    isBooting: false,
    isReady: false,
    error: null,
  });

  const sessionIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const create = useCallback(async () => {
    if (state.isBooting || state.isReady) return;

    const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    sessionIdRef.current = sessionId;

    setState((s) => ({ ...s, isBooting: true, error: null }));

    try {
      const response = await fetch("/api/sandbox/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, runtime }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error || "Failed to create sandbox");
      }

      if (mountedRef.current) {
        setState({
          sessionId,
          isBooting: false,
          isReady: true,
          error: null,
        });
      }
    } catch (error) {
      if (mountedRef.current) {
        setState({
          sessionId: null,
          isBooting: false,
          isReady: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  }, [runtime, state.isBooting, state.isReady]);

  const kill = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;

    try {
      await fetch("/api/sandbox/kill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid }),
      });
    } catch {

    }

    sessionIdRef.current = null;

    if (mountedRef.current) {
      setState({
        sessionId: null,
        isBooting: false,
        isReady: false,
        error: null,
      });
    }
  }, []);

  const syncFiles = useCallback(
    async (files: Array<{ path: string; content: string }>) => {
      const sid = sessionIdRef.current;
      if (!sid) return;

      await fetch("/api/sandbox/files/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid, files }),
      });
    },
    [],
  );

  const exec = useCallback(
    async (command: string, onOutput?: (line: string) => void) => {
      const sid = sessionIdRef.current;
      if (!sid) return 1;

      const response = await fetch("/api/sandbox/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid, command }),
      });

      if (!response.ok) return 1;

      const reader = response.body?.getReader();
      if (!reader) return 1;

      const decoder = new TextDecoder();
      let exitCode = 0;
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const payload = JSON.parse(line.slice(6)) as {
              type: string;
              data: string;
            };
            if (payload.type === "stdout" || payload.type === "stderr") {
              onOutput?.(payload.data);
            } else if (payload.type === "exit") {
              exitCode = parseInt(payload.data, 10) || 0;
            }
          } catch {

          }
        }
      }

      return exitCode;
    },
    [],
  );

  useEffect(() => {
    if (autoCreate && !state.isReady && !state.isBooting) {
      void create();
    }
  }, [autoCreate, create, state.isReady, state.isBooting]);

  useEffect(() => {
    return () => {
      const sid = sessionIdRef.current;
      if (sid) {
        void fetch("/api/sandbox/kill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sid }),
        }).catch(() => {});
      }
    };
  }, []);

  return {
    ...state,
    create,
    kill,
    syncFiles,
    exec,
  };
}
