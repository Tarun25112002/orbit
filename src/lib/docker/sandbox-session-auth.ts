type SessionOwner = {
  userId: string;
  createdAt: number;
};

const owners = new Map<string, SessionOwner>();
const MAX_SESSION_ID_LEN = 200;
const TTL_MS = 2 * 60 * 60 * 1000;

const pruneExpired = () => {
  const now = Date.now();
  for (const [id, row] of owners) {
    if (now - row.createdAt > TTL_MS) {
      owners.delete(id);
    }
  }
};

export const registerSandboxSession = (sessionId: string, userId: string) => {
  if (!sessionId || sessionId.length > MAX_SESSION_ID_LEN) {
    throw new Error("Invalid session id");
  }
  pruneExpired();
  const existing = owners.get(sessionId);
  if (existing && existing.userId !== userId) {
    throw new Error("Session id is already in use");
  }
  owners.set(sessionId, { userId, createdAt: Date.now() });
};

export const releaseSandboxSession = (sessionId: string) => {
  owners.delete(sessionId);
};

export const assertSandboxSessionOwner = (
  sessionId: string | undefined | null,
  userId: string | null,
) => {
  if (!sessionId || sessionId.length > MAX_SESSION_ID_LEN) {
    throw new Error("Invalid session id");
  }
  if (!userId) {
    throw new Error("Unauthorized");
  }

  pruneExpired();
  const row = owners.get(sessionId);
  if (!row) {
    throw new Error("Unknown sandbox session");
  }
  if (row.userId !== userId) {
    throw new Error("Forbidden");
  }
  row.createdAt = Date.now();
};
