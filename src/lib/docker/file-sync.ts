/**
 * File Sync Layer — reads and writes files into Docker containers.
 *
 * Uses tar-stream to create in-memory tar archives, then uploads them
 * to the container's /workspace via Dockerode's putArchive().
 * This avoids shelling out or mounting host paths in weird ways.
 */

import tar from "tar-stream";
import { Readable, PassThrough } from "stream";
import { getContainer, touchSession } from "./session-manager";

const WORKSPACE_ROOT = "/workspace";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Create an in-memory tar archive from a list of file entries.
 *
 * @param files - Array of { path, content } objects
 * @returns A readable stream of the tar archive
 */
function createTarStream(
  files: Array<{ path: string; content: string }>,
): Readable {
  const pack = tar.pack();

  for (const file of files) {
    const normalizedPath = file.path.replace(/^\/+/, "");
    const buffer = Buffer.from(file.content, "utf-8");
    pack.entry({ name: normalizedPath, size: buffer.length }, buffer);
  }

  pack.finalize();
  return pack;
}

/**
 * Parse a tar archive stream and extract file entries.
 *
 * @param stream - The tar archive stream
 * @returns Array of { path, content } objects
 */
async function extractTarStream(
  stream: NodeJS.ReadableStream,
): Promise<Array<{ path: string; content: string }>> {
  return new Promise((resolve, reject) => {
    const extract = tar.extract();
    const files: Array<{ path: string; content: string }> = [];

    extract.on("entry", (header, entryStream, next) => {
      const chunks: Buffer[] = [];

      entryStream.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });

      entryStream.on("end", () => {
        if (header.type === "file") {
          files.push({
            path: header.name,
            content: Buffer.concat(chunks).toString("utf-8"),
          });
        }
        next();
      });

      entryStream.resume();
    });

    extract.on("finish", () => resolve(files));
    extract.on("error", reject);

    // Pipe the Docker stream through a PassThrough first to handle
    // the Dockerode demux format
    const passthrough = new PassThrough();
    stream.pipe(passthrough);
    passthrough.pipe(extract);
  });
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Sync an entire project's files into a container's /workspace.
 *
 * Creates a tar archive of all files and uploads it in one batch.
 * This is called when a user opens a project to seed the container.
 *
 * @param sessionId - The active session to sync files to
 * @param files - Project files as { path, content } pairs
 * @throws If the session doesn't exist or Docker fails
 */
export async function syncProjectToContainer(
  sessionId: string,
  files: Array<{ path: string; content: string }>,
): Promise<void> {
  const container = getContainer(sessionId);
  if (!container) {
    throw new Error(`Session ${sessionId} not found`);
  }

  if (files.length === 0) return;

  touchSession(sessionId);

  const tarStream = createTarStream(files);
  await container.putArchive(tarStream, { path: WORKSPACE_ROOT });
}

/**
 * Sync a single file into the container.
 * Called on debounced file saves from the editor.
 *
 * @param sessionId - The active session
 * @param filePath - Path relative to /workspace (e.g. "src/index.ts")
 * @param content - File content
 */
export async function syncFileToContainer(
  sessionId: string,
  filePath: string,
  content: string,
): Promise<void> {
  const container = getContainer(sessionId);
  if (!container) {
    throw new Error(`Session ${sessionId} not found`);
  }

  touchSession(sessionId);

  // Ensure parent directories exist
  const normalizedPath = filePath.replace(/^\/+/, "");
  const parentDir = normalizedPath.includes("/")
    ? normalizedPath.substring(0, normalizedPath.lastIndexOf("/"))
    : null;

  if (parentDir) {
    const exec = await container.exec({
      Cmd: ["mkdir", "-p", `${WORKSPACE_ROOT}/${parentDir}`],
      AttachStdout: false,
      AttachStderr: false,
    });
    await exec.start({ Detach: true });
  }

  const tarStream = createTarStream([{ path: normalizedPath, content }]);
  await container.putArchive(tarStream, { path: WORKSPACE_ROOT });
}

/**
 * Read a file from the container's /workspace.
 *
 * @param sessionId - The active session
 * @param filePath - Path relative to /workspace
 * @returns File content as a string, or null if not found
 */
export async function readFileFromContainer(
  sessionId: string,
  filePath: string,
): Promise<string | null> {
  const container = getContainer(sessionId);
  if (!container) {
    throw new Error(`Session ${sessionId} not found`);
  }

  touchSession(sessionId);

  const normalizedPath = filePath.replace(/^\/+/, "");
  const fullPath = `${WORKSPACE_ROOT}/${normalizedPath}`;

  try {
    const archiveStream = await container.getArchive({ path: fullPath });
    const files = await extractTarStream(archiveStream);

    if (files.length > 0) {
      return files[0].content;
    }

    return null;
  } catch {
    // File doesn't exist or permission error
    return null;
  }
}
