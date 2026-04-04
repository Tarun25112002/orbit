import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import type { SuggestionProjectContext } from "@/lib/code-suggestion";

const MAX_TREE_ENTRIES = 120;
const MAX_RELATED_FILES = 6;
const MAX_RELATED_FILE_CHARS = 3_000;
const MAX_IMPORT_HINTS = 12;
const MAX_TOP_LEVEL_ENTRIES = 8;
const TOKEN_MIN_LENGTH = 2;
const COMMON_TOKENS = new Set([
  "api",
  "app",
  "component",
  "components",
  "config",
  "const",
  "data",
  "default",
  "file",
  "files",
  "hook",
  "hooks",
  "index",
  "lib",
  "main",
  "page",
  "route",
  "src",
  "test",
  "tests",
  "type",
  "types",
  "ui",
  "use",
  "utils",
]);
const IMPORT_PATTERNS = [
  /from\s+["'`]([^"'`]+)["'`]/g,
  /import\s+["'`]([^"'`]+)["'`]/g,
  /require\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
  /import\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
];

type ProjectItem = Doc<"files">;
type ProjectFile = ProjectItem & { type: "file"; content?: string };

interface IndexedProjectFile {
  id: Id<"files">;
  path: string;
  dir: string;
  basename: string;
  extension: string;
  content: string;
}

interface ScoredFile {
  file: IndexedProjectFile;
  score: number;
  reasons: string[];
}

const normalizePath = (value: string) => {
  const stack: string[] = [];

  for (const segment of value.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      stack.pop();
      continue;
    }

    stack.push(segment);
  }

  return stack.join("/");
};

const trimFileContent = (value: string) => {
  if (value.length <= MAX_RELATED_FILE_CHARS) {
    return value;
  }

  return `${value.slice(0, MAX_RELATED_FILE_CHARS)}\n...`;
};

const dirname = (path: string) => {
  const normalized = normalizePath(path);
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash === -1 ? "" : normalized.slice(0, lastSlash);
};

const basename = (path: string) => {
  const normalized = normalizePath(path);
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
};

const stripExtension = (path: string) =>
  normalizePath(path).replace(/\.[^/.]+$/, "");

const getExtension = (path: string) => {
  const name = basename(path);
  const lastDot = name.lastIndexOf(".");
  return lastDot === -1 ? "" : name.slice(lastDot + 1).toLowerCase();
};

const tokenize = (value: string) =>
  Array.from(
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(
          (token) =>
            token.length >= TOKEN_MIN_LENGTH && !COMMON_TOKENS.has(token),
        ),
    ),
  );

const collectMatches = (pattern: RegExp, value: string) => {
  const matches: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    const candidate = match[1]?.trim();
    if (candidate) {
      matches.push(candidate);
    }
  }

  return matches;
};

const extractImportHints = (code: string) =>
  Array.from(
    new Set(
      IMPORT_PATTERNS.flatMap((pattern) =>
        collectMatches(new RegExp(pattern.source, "g"), code),
      ),
    ),
  ).slice(0, MAX_IMPORT_HINTS);

const resolveImportCandidates = (importPath: string, activeFilePath: string) => {
  const normalizedImport = normalizePath(importPath);

  if (!normalizedImport) {
    return [];
  }

  let resolved = normalizedImport;

  if (normalizedImport.startsWith("@/")) {
    resolved = normalizedImport.slice(2);
  } else if (normalizedImport.startsWith("/")) {
    resolved = normalizedImport.slice(1);
  } else if (
    normalizedImport.startsWith("./") ||
    normalizedImport.startsWith("../")
  ) {
    resolved = normalizePath(
      [dirname(activeFilePath), normalizedImport].filter(Boolean).join("/"),
    );
  } else if (!normalizedImport.includes("/")) {
    return [];
  }

  const withoutExtension = stripExtension(resolved);

  return Array.from(
    new Set([
      normalizePath(resolved),
      withoutExtension,
      normalizePath(`${withoutExtension}/index`),
    ]),
  );
};

const matchesImportHint = (
  importPath: string,
  candidatePath: string,
  activeFilePath: string,
) => {
  const normalizedCandidatePath = normalizePath(candidatePath);
  const normalizedCandidateBase = stripExtension(candidatePath);

  return resolveImportCandidates(importPath, activeFilePath).some(
    (resolvedPath) =>
      resolvedPath === normalizedCandidatePath ||
      resolvedPath === normalizedCandidateBase,
  );
};

const buildPathMap = (projectFiles: ProjectItem[]) => {
  const byId = new Map(projectFiles.map((file) => [file._id, file]));
  const cache = new Map<Id<"files">, string>();

  const getPath = (fileId: Id<"files">): string => {
    const cached = cache.get(fileId);
    if (cached) {
      return cached;
    }

    const file = byId.get(fileId);
    if (!file) {
      return "";
    }

    const path = file.parentId
      ? normalizePath(`${getPath(file.parentId)}/${file.name}`)
      : normalizePath(file.name);

    cache.set(fileId, path);
    return path;
  };

  return new Map(projectFiles.map((file) => [file._id, getPath(file._id)]));
};

const indexProjectFiles = (
  projectFiles: ProjectItem[],
  pathMap: Map<Id<"files">, string>,
) =>
  projectFiles
    .filter((file): file is ProjectFile => file.type === "file")
    .map((file) => {
      const path = pathMap.get(file._id) ?? file.name;
      const name = basename(path);
      const base = stripExtension(name);

      return {
        id: file._id,
        path,
        dir: dirname(path),
        basename: base,
        extension: getExtension(path),
        content: file.content ?? "",
      } satisfies IndexedProjectFile;
    });

const buildWorkspaceTree = (
  projectFiles: ProjectItem[],
  pathMap: Map<Id<"files">, string>,
) => {
  const entries = projectFiles
    .map((file) => ({
      label: `${file.type === "folder" ? "DIR " : "FILE"} ${pathMap.get(file._id) ?? file.name}`,
      path: pathMap.get(file._id) ?? file.name,
    }))
    .sort((left, right) => left.path.localeCompare(right.path))
    .slice(0, MAX_TREE_ENTRIES)
    .map((entry) => entry.label);

  return entries.join("\n");
};

const buildWorkspaceSummary = (
  projectFiles: ProjectItem[],
  activeFilePath: string,
  pathMap: Map<Id<"files">, string>,
) => {
  const folders = projectFiles.filter((file) => file.type === "folder");
  const files = projectFiles.length - folders.length;
  const topLevelEntries = projectFiles
    .filter((file) => !file.parentId)
    .map((file) => pathMap.get(file._id) ?? file.name)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, MAX_TOP_LEVEL_ENTRIES);

  return [
    `Workspace has ${files} files and ${folders.length} folders.`,
    `Active file: ${activeFilePath}.`,
    topLevelEntries.length > 0
      ? `Top-level entries: ${topLevelEntries.join(", ")}.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
};

const scoreCandidateFile = ({
  activeFilePath,
  activeFileTokens,
  activeFileExtension,
  activeFileDir,
  candidate,
  importHints,
}: {
  activeFilePath: string;
  activeFileTokens: Set<string>;
  activeFileExtension: string;
  activeFileDir: string;
  candidate: IndexedProjectFile;
  importHints: string[];
}): ScoredFile => {
  let score = 0;
  const reasons: string[] = [];

  if (candidate.dir === activeFileDir) {
    score += 5;
    reasons.push("same-directory");
  }

  if (activeFileExtension && candidate.extension === activeFileExtension) {
    score += 2;
    reasons.push("same-extension");
  }

  const candidateTokens = tokenize(candidate.basename);
  const sharedTokens = candidateTokens.filter((token) =>
    activeFileTokens.has(token),
  );
  if (sharedTokens.length > 0) {
    score += Math.min(4, sharedTokens.length * 2);
    reasons.push("shared-name-tokens");
  }

  const matchingImports = importHints.filter((hint) =>
    matchesImportHint(hint, candidate.path, activeFilePath),
  );
  if (matchingImports.length > 0) {
    score += 12 + matchingImports.length * 2;
    reasons.push("import-match");
  }

  if (
    candidate.content &&
    activeFileTokens.size > 0 &&
    Array.from(activeFileTokens).some((token) =>
      candidate.content.toLowerCase().includes(token),
    )
  ) {
    score += 1;
    reasons.push("content-overlap");
  }

  return { file: candidate, score, reasons };
};

const selectRelatedFiles = ({
  indexedFiles,
  activeFileId,
  activeFilePath,
  currentCode,
}: {
  indexedFiles: IndexedProjectFile[];
  activeFileId: Id<"files">;
  activeFilePath: string;
  currentCode: string;
}) => {
  const activeFileName = basename(activeFilePath);
  const activeFileExtension = getExtension(activeFilePath);
  const activeFileDir = dirname(activeFilePath);
  const activeFileTokens = new Set(tokenize(activeFileName));
  const importHints = extractImportHints(currentCode);

  const scored = indexedFiles
    .filter((file) => file.id !== activeFileId)
    .map((candidate) =>
      scoreCandidateFile({
        activeFilePath,
        activeFileTokens,
        activeFileExtension,
        activeFileDir,
        candidate,
        importHints,
      }),
    )
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.file.path.localeCompare(right.file.path);
    });

  const withPositiveScore = scored.filter((entry) => entry.score > 0);
  const selected =
    withPositiveScore.length > 0
      ? withPositiveScore.slice(0, MAX_RELATED_FILES)
      : scored
          .filter(
            (entry) =>
              entry.file.dir === activeFileDir ||
              entry.file.extension === activeFileExtension,
          )
          .slice(0, MAX_RELATED_FILES);

  return {
    importHints,
    relatedFiles: selected.map((entry) => ({
      path: entry.file.path,
      content: trimFileContent(entry.file.content),
      score: entry.score,
      reason: entry.reasons.join(", "),
    })),
  };
};

export const buildProjectFilePathMap = (projectFiles: ProjectItem[]) =>
  buildPathMap(projectFiles);

export const buildSuggestionProjectContext = ({
  activeFileId,
  currentCode,
  projectFiles,
}: {
  activeFileId: Id<"files">;
  currentCode: string;
  projectFiles: ProjectItem[];
}): SuggestionProjectContext | undefined => {
  if (projectFiles.length === 0) {
    return undefined;
  }

  const pathMap = buildPathMap(projectFiles);
  const activeFilePath = pathMap.get(activeFileId);
  if (!activeFilePath) {
    return undefined;
  }

  const indexedFiles = indexProjectFiles(projectFiles, pathMap);
  const { importHints, relatedFiles } = selectRelatedFiles({
    indexedFiles,
    activeFileId,
    activeFilePath,
    currentCode,
  });

  return {
    activeFilePath,
    workspaceSummary: buildWorkspaceSummary(
      projectFiles,
      activeFilePath,
      pathMap,
    ),
    workspaceTree: buildWorkspaceTree(projectFiles, pathMap),
    importHints,
    relatedFiles,
  };
};
