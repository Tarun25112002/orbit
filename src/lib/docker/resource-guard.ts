import {
  listActiveSessions,
  killSession,
  type SandboxSession,
} from "./session-manager";

const MAX_CONTAINERS = 10;
const MEMORY_CEILING_MB = 20 * 1024;
const AGGRESSIVE_IDLE_MS = 10 * 60 * 1000;

export interface SandboxStats {
  activeSessions: number;
  maxSessions: number;
  sessions: Array<{
    sessionId: string;
    runtime: string;
    idleMinutes: number;
  }>;
}

export async function ensureCapacity(): Promise<boolean> {
  const active = listActiveSessions();

  if (active.length < MAX_CONTAINERS) {
    return true;
  }

  const now = Date.now();
  const idle = active
    .filter((s) => now - s.lastActivityAt > AGGRESSIVE_IDLE_MS)
    .sort((a, b) => a.lastActivityAt - b.lastActivityAt);

  if (idle.length > 0) {
    await killSession(idle[0].sessionId);
    return true;
  }

  return false;
}

export function getStats(): SandboxStats {
  const now = Date.now();
  const active = listActiveSessions();

  return {
    activeSessions: active.length,
    maxSessions: MAX_CONTAINERS,
    sessions: active.map((s) => ({
      sessionId: s.sessionId,
      runtime: s.runtime,
      idleMinutes: Math.round((now - s.lastActivityAt) / 60_000),
    })),
  };
}

export async function killAllSessions(): Promise<void> {
  const active = listActiveSessions();
  await Promise.allSettled(active.map((s) => killSession(s.sessionId)));
}
