"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const WS_URL =
  typeof window !== "undefined"
    ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.hostname}:${process.env.NEXT_PUBLIC_WS_PORT || "3001"}`
    : "";

interface UseTerminalOptions {
  sessionId: string | null;
  onOutput?: (data: string) => void;
  autoConnect?: boolean;
}

export function useTerminal(options: UseTerminalOptions) {
  const { sessionId, onOutput, autoConnect = true } = options;
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    if (mountedRef.current) {
      setIsConnected(false);
    }
  }, []);

  const connect = useCallback(() => {
    if (!sessionId || !WS_URL) return;

    disconnect();

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {

      ws.send(JSON.stringify({ type: "attach", sessionId }));
      if (mountedRef.current) {
        setIsConnected(true);
        setError(null);
      }
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as {
          type: string;
          data?: string;
          message?: string;
          code?: number;
        };

        if (message.type === "output" && message.data) {
          onOutput?.(message.data);
        } else if (message.type === "error" && message.message) {
          if (mountedRef.current) {
            setError(message.message);
          }
        } else if (message.type === "exit") {
          onOutput?.(`\r\n[Process exited with code ${message.code ?? 0}]\r\n`);
        }
      } catch {

      }
    };

    ws.onclose = () => {
      if (mountedRef.current) {
        setIsConnected(false);

        if (sessionId) {
          reconnectTimerRef.current = setTimeout(() => {
            if (mountedRef.current && sessionId) {
              connect();
            }
          }, 2000);
        }
      }
    };

    ws.onerror = () => {
      if (mountedRef.current) {
        setError("WebSocket connection failed");
        setIsConnected(false);
      }
    };
  }, [sessionId, disconnect, onOutput]);

  const sendInput = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "input", data }));
    }
  }, []);

  const resize = useCallback((cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  }, []);

  useEffect(() => {
    if (autoConnect && sessionId) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, sessionId, connect, disconnect]);

  return {
    isConnected,
    error,
    connect,
    disconnect,
    sendInput,
    resize,
  };
}
