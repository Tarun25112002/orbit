import tar from "tar-stream";
import { Readable, PassThrough } from "stream";
import { getContainer, touchSession } from "./session-manager";

const WORKSPACE_ROOT = "/workspace";

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

    const passthrough = new PassThrough();
    stream.pipe(passthrough);
    passthrough.pipe(extract);
  });
}

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

    return null;
  }
}
