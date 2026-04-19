/**
 * Docker Session Manager — Server-side singleton
 *
 * Manages the full lifecycle of per-user sandbox containers:
 * create → track → idle-kill → cleanup.
 *
 * Architecture decisions:
 * - Server-side only (never import from client code)
 * - One container per sessionId
 * - Containers use a custom bridge network (orbit-network)
 * - Each container gets a host-side workspace volume
 * - Idle containers are auto-killed after IDLE_TIMEOUT_MS
 * - On server restart, orphaned orbit-* containers are cleaned up
 */

import Docker from "dockerode";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Supported sandbox runtimes */
export type SandboxRuntime = "node" | "python" | "bash";

/** A tracked sandbox session */
export interface SandboxSession {
  sessionId: string;
  containerId: string;
  runtime: SandboxRuntime;
  workspacePath: string;
  createdAt: number;
  lastActivityAt: number;
}

/** Result of creating a new session */
export interface CreateSessionResult {
  sessionId: string;
  containerId: string;
  workspacePath: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const CONTAINER_PREFIX = "orbit-session-";
const NETWORK_NAME = "orbit-network";
const WORKSPACE_BASE =
  process.env.ORBIT_WORKSPACE_BASE || join(tmpdir(), "orbit-workspaces");
const CONTAINER_WORKSPACE = "/workspace";

const MEMORY_LIMIT = 1.5 * 1024 * 1024 * 1024; // 1.5 GB
const CPU_QUOTA = 50_000; // 0.5 CPUs (out of 100_000)
const CPU_PERIOD = 100_000;
const MAX_CONTAINERS = 10;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // Check every 60s

/** Maps runtime → Docker image name */
const RUNTIME_IMAGES: Record<SandboxRuntime, string> = {
  node: "orbit-node:latest",
  python: "orbit-python:latest",
  bash: "ubuntu:22.04",
};

// ─── Docker client ──────────────────────────────────────────────────────────

/**
 * Resolve the Docker connection config based on platform.
 * - DOCKER_HOST env var takes precedence (e.g. tcp://localhost:2375)
 * - Windows: named pipe //./pipe/docker_engine
 * - Linux/Mac: /var/run/docker.sock
 */
function createDockerClient(): Docker {
  if (process.env.DOCKER_HOST) {
    return new Docker({ host: process.env.DOCKER_HOST });
  }

  if (process.platform === "win32") {
    return new Docker({ socketPath: "//./pipe/docker_engine" });
  }

  return new Docker({ socketPath: "/var/run/docker.sock" });
}

const docker = createDockerClient();

// ─── Session store ──────────────────────────────────────────────────────────

const sessions = new Map<string, SandboxSession>();
let cleanupTimer: ReturnType<typeof setInterval> | null = null;
let networkEnsured = false;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Ensure the custom Docker bridge network exists */
async function ensureNetwork(): Promise<void> {
  if (networkEnsured) return;

  try {
    const network = docker.getNetwork(NETWORK_NAME);
    await network.inspect();
    networkEnsured = true;
  } catch {
    await docker.createNetwork({
      Name: NETWORK_NAME,
      Driver: "bridge",
      Internal: false,
    });
    networkEnsured = true;
  }
}

/** Build the container name from a session ID */
function containerName(sessionId: string): string {
  return `${CONTAINER_PREFIX}${sessionId}`;
}

/** Build the host workspace path for a session */
function workspacePath(sessionId: string): string {
  return join(WORKSPACE_BASE, `workspace-${sessionId}`);
}

/** Ensure the host workspace directory exists */
function ensureWorkspaceDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

/** Remove the host workspace directory */
function removeWorkspaceDir(dirPath: string): void {
  try {
    if (existsSync(dirPath)) {
      rmSync(dirPath, { recursive: true, force: true });
    }
  } catch {
    // Best-effort cleanup
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Create a new sandbox session.
 *
 * Spins up an isolated Docker container with the requested runtime,
 * resource limits, and a mounted workspace volume.
 *
 * @param sessionId - Unique session identifier (typically from the client)
 * @param runtime - The runtime environment to use
 * @returns Session metadata including containerId and workspacePath
 * @throws If the container limit is reached or Docker fails
 */
export async function createSession(
  sessionId: string,
  runtime: SandboxRuntime,
): Promise<CreateSessionResult> {
  // Guard: already exists
  const existing = sessions.get(sessionId);
  if (existing) {
    existing.lastActivityAt = Date.now();
    return {
      sessionId: existing.sessionId,
      containerId: existing.containerId,
      workspacePath: existing.workspacePath,
    };
  }

  // Guard: capacity
  if (sessions.size >= MAX_CONTAINERS) {
    // Try to evict the oldest idle session
    const evicted = findOldestIdleSession();
    if (evicted) {
      await killSession(evicted.sessionId);
    } else {
      throw new Error(
        `Maximum container limit (${MAX_CONTAINERS}) reached. Try again later.`,
      );
    }
  }

  await ensureNetwork();

  const hostWorkspace = workspacePath(sessionId);
  ensureWorkspaceDir(hostWorkspace);

  const image = RUNTIME_IMAGES[runtime];
  const name = containerName(sessionId);

  const container = await docker.createContainer({
    Image: image,
    name,
    Tty: true,
    OpenStdin: true,
    Cmd: ["/bin/sh"],
    WorkingDir: CONTAINER_WORKSPACE,
    HostConfig: {
      Memory: MEMORY_LIMIT,
      CpuQuota: CPU_QUOTA,
      CpuPeriod: CPU_PERIOD,
      NetworkMode: NETWORK_NAME,
      Binds: [`${hostWorkspace}:${CONTAINER_WORKSPACE}`],
      SecurityOpt: ["no-new-privileges"],
      CapDrop: ["ALL"],
      CapAdd: ["CHOWN", "SETUID", "SETGID"],
      // Expose a port range for dev servers
      PublishAllPorts: true,
    },
    ExposedPorts: {
      "3000/tcp": {},
      "3001/tcp": {},
      "4173/tcp": {},
      "5000/tcp": {},
      "5173/tcp": {},
      "8000/tcp": {},
      "8080/tcp": {},
      "8888/tcp": {},
    },
    Labels: {
      "orbit.session": sessionId,
      "orbit.runtime": runtime,
      "orbit.created": String(Date.now()),
    },
  });

  await container.start();

  const now = Date.now();
  const session: SandboxSession = {
    sessionId,
    containerId: container.id,
    runtime,
    workspacePath: hostWorkspace,
    createdAt: now,
    lastActivityAt: now,
  };

  sessions.set(sessionId, session);
  startCleanupTimer();

  return {
    sessionId,
    containerId: container.id,
    workspacePath: hostWorkspace,
  };
}

/**
 * Retrieve an active session by its ID.
 * Also bumps lastActivityAt to reset the idle timer.
 *
 * @param sessionId - Session to look up
 * @returns The session, or null if not found
 */
export function getSession(sessionId: string): SandboxSession | null {
  const session = sessions.get(sessionId);
  if (!session) return null;

  session.lastActivityAt = Date.now();
  return session;
}

/**
 * Kill a session: stop + remove the container, clean up workspace.
 *
 * @param sessionId - The session to kill
 */
export async function killSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  sessions.delete(sessionId);

  if (session) {
    try {
      const container = docker.getContainer(session.containerId);
      await container.stop({ t: 2 }).catch(() => {});
      await container.remove({ force: true }).catch(() => {});
    } catch {
      // Container may already be gone
    }
    removeWorkspaceDir(session.workspacePath);
  } else {
    // Try by container name in case the session wasn't tracked
    try {
      const name = containerName(sessionId);
      const container = docker.getContainer(name);
      await container.stop({ t: 2 }).catch(() => {});
      await container.remove({ force: true }).catch(() => {});
    } catch {
      // Best effort
    }
    removeWorkspaceDir(workspacePath(sessionId));
  }
}

/**
 * List all active sandbox sessions.
 *
 * @returns Array of current sessions
 */
export function listActiveSessions(): SandboxSession[] {
  return Array.from(sessions.values());
}

/**
 * Get the underlying Docker client.
 * Used by other modules (file sync, terminal bridge) that need direct access.
 *
 * @returns The dockerode instance
 */
export function getDockerClient(): Docker {
  return docker;
}

/**
 * Get the Docker container instance for a session.
 *
 * @param sessionId - Session to look up
 * @returns The dockerode Container, or null
 */
export function getContainer(sessionId: string): Docker.Container | null {
  const session = sessions.get(sessionId);
  if (!session) return null;

  session.lastActivityAt = Date.now();
  return docker.getContainer(session.containerId);
}

/**
 * Get the mapped host port for a container's internal port.
 *
 * @param sessionId - The session to inspect
 * @param containerPort - The port inside the container (e.g. 3000)
 * @returns The host port number, or null if not mapped
 */
export async function getMappedPort(
  sessionId: string,
  containerPort: number,
): Promise<number | null> {
  const container = getContainer(sessionId);
  if (!container) return null;

  try {
    const info = await container.inspect();
    const portKey = `${containerPort}/tcp`;
    const bindings = info.NetworkSettings.Ports[portKey];

    if (bindings && bindings.length > 0) {
      const hostPort = parseInt(bindings[0].HostPort, 10);
      return isNaN(hostPort) ? null : hostPort;
    }
  } catch {
    // Container may be gone
  }

  return null;
}

/**
 * Record activity for a session (resets the idle timer).
 *
 * @param sessionId - Session to touch
 */
export function touchSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.lastActivityAt = Date.now();
  }
}

/**
 * Cleanup orphaned orbit-* containers from a previous server run.
 * Call this once at server startup.
 */
export async function cleanupOrphanedContainers(): Promise<void> {
  try {
    const containers = await docker.listContainers({
      all: true,
      filters: { name: [CONTAINER_PREFIX] },
    });

    for (const containerInfo of containers) {
      const name =
        containerInfo.Names[0]?.replace(/^\//, "") ?? "";
      if (!name.startsWith(CONTAINER_PREFIX)) continue;

      const sessionId = name.replace(CONTAINER_PREFIX, "");

      // Skip if this session is actively tracked (shouldn't happen on fresh boot)
      if (sessions.has(sessionId)) continue;

      try {
        const container = docker.getContainer(containerInfo.Id);
        if (containerInfo.State === "running") {
          await container.stop({ t: 2 }).catch(() => {});
        }
        await container.remove({ force: true }).catch(() => {});
      } catch {
        // Best effort
      }

      removeWorkspaceDir(workspacePath(sessionId));
    }
  } catch {
    // Docker may not be available during dev on Windows/Mac
    console.warn(
      "[orbit:sandbox] Could not clean up orphaned containers (Docker may not be available)",
    );
  }
}

// ─── Internal ───────────────────────────────────────────────────────────────

function findOldestIdleSession(): SandboxSession | null {
  let oldest: SandboxSession | null = null;

  for (const session of sessions.values()) {
    if (!oldest || session.lastActivityAt < oldest.lastActivityAt) {
      oldest = session;
    }
  }

  return oldest;
}

function startCleanupTimer(): void {
  if (cleanupTimer) return;

  cleanupTimer = setInterval(async () => {
    const now = Date.now();
    const toKill: string[] = [];

    for (const session of sessions.values()) {
      if (now - session.lastActivityAt > IDLE_TIMEOUT_MS) {
        toKill.push(session.sessionId);
      }
    }

    for (const sessionId of toKill) {
      console.info(`[orbit:sandbox] Killing idle session: ${sessionId}`);
      await killSession(sessionId).catch((error) => {
        console.error(
          `[orbit:sandbox] Failed to kill idle session ${sessionId}:`,
          error,
        );
      });
    }

    // Stop timer if no sessions left
    if (sessions.size === 0 && cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }, CLEANUP_INTERVAL_MS);

  // Don't keep the Node.js process alive just for this timer
  if (cleanupTimer && typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }
}
