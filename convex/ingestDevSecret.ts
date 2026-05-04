/**
 * Local-only ingest token. Next uses this when ORBIT_CONVEX_INGEST_SECRET is
 * unset in non-production; Convex accepts it only when
 * ORBIT_CONVEX_INGEST_ALLOW_LOCAL_DEV_INGEST=1 on that deployment.
 */
export const ORBIT_LOCAL_DEV_INGEST_SECRET = "__orbit_convex_ingest_local_dev__";
