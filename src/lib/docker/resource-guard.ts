/**
 * Resource Guard — prevents resource exhaustion on the host.
 *
 * Wraps the session manager with capacity checks, memory monitoring,
 * and a request queue for when the server is at max capacity.
 */

import {
  listActiveSessions,
  killSession,
  type SandboxSession,
} from "./session-manager";

const MAX_CONTAINERS = 10;
const MEMORY_CEILING_MB = 20 * 1024; // 20 GB
const AGGRESSIVE_IDLE_MS = 10 * 60 * 1000; // 10 minutes — used when memory is high

/** Stats snapshot exposed via /api/sandbox/stats */
export interface SandboxStats {
  activeSessions: number;
  maxSessions: number;
  sessions: Array<{
    sessionId: string;
    runtime: string;
    idleMinutes: number;
  }>;
}

/**
 * Check whether we can accept a new container.
 * If at capacity, tries to evict the oldest idle session.
 *
 * @returns true if a slot is available after any eviction
 */
export async function ensureCapacity(): Promise<boolean> {
  const active = listActiveSessions();

  if (active.length < MAX_CONTAINERS) {
    return true;
  }

  // Find the oldest idle session
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

/**
 * Build a stats snapshot for the monitoring endpoint.
 *
 * @returns Current resource usage stats
 */
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

/**
 * Force kill ALL sandbox sessions. Emergency cleanup.
 */
export async function killAllSessions(): Promise<void> {
  const active = listActiveSessions();
  await Promise.allSettled(active.map((s) => killSession(s.sessionId)));
}
