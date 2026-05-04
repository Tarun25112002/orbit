/**
 * Shared secret so only trusted server jobs (Inngest) can call Convex `system`
 * mutations/queries without an end-user JWT. Set the same value in the Convex
 * dashboard (env var `ORBIT_CONVEX_INGEST_SECRET`) and in this Next.js host.
 */
export function withIngestSecret<T extends Record<string, unknown>>(
  args: T,
): T & { ingestSecret: string } {
  const ingestSecret = process.env.ORBIT_CONVEX_INGEST_SECRET?.trim();
  if (!ingestSecret) {
    throw new Error(
      "ORBIT_CONVEX_INGEST_SECRET is not set. Add it to Convex env and this server so Inngest can run safely.",
    );
  }
  return { ...args, ingestSecret };
}
