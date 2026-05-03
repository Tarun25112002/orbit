import Docker from "dockerode";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

export type SandboxRuntime = "node" | "python" | "bash";

export interface SandboxSession {
  sessionId: string;
  containerId: string;
  runtime: SandboxRuntime;
  projectKey: string | null;
  workspacePath: string;
  createdAt: number;
  lastActivityAt: number;
}

export interface CreateSessionResult {
  sessionId: string;
  containerId: string;
  workspacePath: string;
}

const CONTAINER_PREFIX = "orbit-session-";
const NETWORK_NAME = "orbit-network";
const WORKSPACE_BASE =
  process.env.ORBIT_WORKSPACE_BASE || join(tmpdir(), "orbit-workspaces");
const NODE_MODULES_CACHE_BASE =
  process.env.ORBIT_NODE_MODULES_CACHE_BASE ||
  join(tmpdir(), "orbit-node-modules-cache");
const CONTAINER_WORKSPACE = "/workspace";

const MEMORY_LIMIT = 1.5 * 1024 * 1024 * 1024;
const CPU_QUOTA = 50_000;
const CPU_PERIOD = 100_000;
const MAX_CONTAINERS = 10;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;

const RUNTIME_IMAGES: Record<SandboxRuntime, string> = {
  node: "orbit-node:latest",
  python: "orbit-python:latest",
  bash: "ubuntu:22.04",
};

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

declare global {
  // eslint-disable-next-line no-var
  var __dockerSessions: Map<string, SandboxSession> | undefined;
}

const sessions =
  globalThis.__dockerSessions || new Map<string, SandboxSession>();
if (process.env.NODE_ENV !== "production") {
  globalThis.__dockerSessions = sessions;
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null;
let networkEnsured = false;

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

function containerName(sessionId: string): string {
  return `${CONTAINER_PREFIX}${sessionId}`;
}

function workspacePath(sessionId: string): string {
  return join(WORKSPACE_BASE, `workspace-${sessionId}`);
}

function nodeModulesCachePath(projectKey: string): string {
  return join(NODE_MODULES_CACHE_BASE, `node-modules-${projectKey}`);
}

function normalizeProjectKey(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 80);

  return normalized || null;
}

function ensureWorkspaceDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

function removeWorkspaceDir(dirPath: string): void {
  try {
    if (existsSync(dirPath)) {
      rmSync(dirPath, { recursive: true, force: true });
    }
  } catch {

  }
}

const CONTAINER_MISSING_PATTERN = /no such container|not found/i;

const isContainerMissingError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const statusCode =
    typeof (error as { statusCode?: number }).statusCode === "number"
      ? (error as { statusCode?: number }).statusCode
      : undefined;

  return statusCode === 404 || CONTAINER_MISSING_PATTERN.test(message);
};

export async function createSession(
  sessionId: string,
  runtime: SandboxRuntime,
  options?: { projectKey?: string },
): Promise<CreateSessionResult> {
  const projectKey = normalizeProjectKey(options?.projectKey);

  const existing = sessions.get(sessionId);
  if (existing) {
    try {
      await docker.getContainer(existing.containerId).inspect();

      existing.lastActivityAt = Date.now();
      return {
        sessionId: existing.sessionId,
        containerId: existing.containerId,
        workspacePath: existing.workspacePath,
      };
    } catch (error) {
      if (!isContainerMissingError(error)) {
        throw error;
      }

      sessions.delete(sessionId);
    }
  }

  if (sessions.size >= MAX_CONTAINERS) {

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

  let hostNodeModulesCache: string | null = null;
  if (runtime === "node" && projectKey) {
    hostNodeModulesCache = nodeModulesCachePath(projectKey);
    ensureWorkspaceDir(hostNodeModulesCache);
  }

  const binds = [`${hostWorkspace}:${CONTAINER_WORKSPACE}`];
  if (hostNodeModulesCache) {
    binds.push(`${hostNodeModulesCache}:${CONTAINER_WORKSPACE}/node_modules`);
  }

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
      Binds: binds,
      SecurityOpt: ["no-new-privileges"],
      CapDrop: ["ALL"],
      CapAdd: ["CHOWN", "SETUID", "SETGID"],

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
      ...(projectKey ? { "orbit.project_key": projectKey } : {}),
      "orbit.created": String(Date.now()),
    },
  });

  await container.start();

  const now = Date.now();
  const session: SandboxSession = {
    sessionId,
    containerId: container.id,
    runtime,
    projectKey,
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

export function getSession(sessionId: string): SandboxSession | null {
  const session = sessions.get(sessionId);
  if (!session) return null;

  session.lastActivityAt = Date.now();
  return session;
}

export async function killSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  sessions.delete(sessionId);

  if (session) {
    try {
      const container = docker.getContainer(session.containerId);
      await container.stop({ t: 2 }).catch(() => {});
      await container.remove({ force: true }).catch(() => {});
    } catch {

    }
    removeWorkspaceDir(session.workspacePath);
  } else {

    try {
      const name = containerName(sessionId);
      const container = docker.getContainer(name);
      await container.stop({ t: 2 }).catch(() => {});
      await container.remove({ force: true }).catch(() => {});
    } catch {

    }
    removeWorkspaceDir(workspacePath(sessionId));
  }
}

export function listActiveSessions(): SandboxSession[] {
  return Array.from(sessions.values());
}

export function getDockerClient(): Docker {
  return docker;
}

export function getContainer(sessionId: string): Docker.Container | null {
  const session = sessions.get(sessionId);
  if (session) {
    session.lastActivityAt = Date.now();
    return docker.getContainer(session.containerId);
  }

  return docker.getContainer(containerName(sessionId));
}

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

  }

  return null;
}

export function touchSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.lastActivityAt = Date.now();
  }
}

export async function cleanupOrphanedContainers(): Promise<void> {
  try {
    const containers = await docker.listContainers({
      all: true,
      filters: { name: [CONTAINER_PREFIX] },
    });

    for (const containerInfo of containers) {
      const name = containerInfo.Names[0]?.replace(/^\//, "") ?? "";
      if (!name.startsWith(CONTAINER_PREFIX)) continue;

      const sessionId = name.replace(CONTAINER_PREFIX, "");

      if (sessions.has(sessionId)) continue;

      try {
        const container = docker.getContainer(containerInfo.Id);
        if (containerInfo.State === "running") {
          await container.stop({ t: 2 }).catch(() => {});
        }
        await container.remove({ force: true }).catch(() => {});
      } catch {

      }

      removeWorkspaceDir(workspacePath(sessionId));
    }
  } catch {

    console.warn(
      "[orbit:sandbox] Could not clean up orphaned containers (Docker may not be available)",
    );
  }
}

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

    if (sessions.size === 0 && cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }, CLEANUP_INTERVAL_MS);

  if (
    cleanupTimer &&
    typeof cleanupTimer === "object" &&
    "unref" in cleanupTimer
  ) {
    cleanupTimer.unref();
  }
}
