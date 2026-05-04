import { ORBIT_LOCAL_DEV_INGEST_SECRET } from "../../convex/ingestDevSecret";

let warnedDevIngest = false;

/**
 * Shared secret so only trusted server jobs (Inngest) can call Convex `system`
 * mutations/queries without an end-user JWT. Set the same value in the Convex
 * dashboard (`ORBIT_CONVEX_INGEST_SECRET`) and on this Next.js host.
 *
 * In **non-production** Node, if that variable is unset, a fixed local-dev token
 * is used; the Convex deployment must allow it with
 * `ORBIT_CONVEX_INGEST_DEV_OK=1` (dev only — never in prod).
 */
export function withIngestSecret<T extends Record<string, unknown>>(
  args: T,
): T & { ingestSecret: string } {
  const configured = process.env.ORBIT_CONVEX_INGEST_SECRET?.trim();
  const ingestSecret =
    configured ||
    (process.env.NODE_ENV !== "production"
      ? ORBIT_LOCAL_DEV_INGEST_SECRET
      : "");

  if (!ingestSecret) {
    throw new Error(
      "ORBIT_CONVEX_INGEST_SECRET is not set. Set it on this server and in Convex (same value) for Inngest and other server jobs. For local dev without a secret, run Next in non-production and set ORBIT_CONVEX_INGEST_DEV_OK=1 on your Convex dev deployment.",
    );
  }

  if (!configured && process.env.NODE_ENV !== "production") {
    if (!warnedDevIngest) {
      warnedDevIngest = true;
      console.warn(
        "[orbit] ORBIT_CONVEX_INGEST_SECRET unset — using local dev ingest token. Convex must allow it: npx convex env set ORBIT_CONVEX_INGEST_DEV_OK 1",
      );
    }
  }

  return { ...args, ingestSecret };
}
