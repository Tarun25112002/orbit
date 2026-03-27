import type { ElementType, ReactElement } from "react";
import { FileIcon } from "lucide-react";
import {
  VscFileCode,
  VscFileMedia,
  VscFolder,
  VscFolderOpened,
  VscJson,
  VscMarkdown,
  VscSettingsGear,
  VscTerminalBash,
} from "react-icons/vsc";
import {
  SiCss,
  SiDocker,
  SiGit,
  SiGraphql,
  SiHtml5,
  SiJavascript,
  SiMdx,
  SiNextdotjs,
  SiNodedotjs,
  SiNpm,
  SiPnpm,
  SiPostcss,
  SiPrisma,
  SiPython,
  SiReact,
  SiRust,
  SiSqlite,
  SiSvg,
  SiTailwindcss,
  SiToml,
  SiTypescript,
  SiVitest,
  SiYaml,
  SiYarn,
} from "react-icons/si";

import { cn } from "@/lib/utils";

type IconRenderer = (className?: string) => ReactElement;

const renderIcon = (Icon: ElementType, defaultClassName: string): IconRenderer => {
  function NamedIconRenderer(className?: string) {
    return (
      <Icon className={cn("size-4 shrink-0", defaultClassName, className)} />
    );
  }

  return NamedIconRenderer;
};

const defaultFileIcon = renderIcon(FileIcon, "text-muted-foreground");
const defaultCodeIcon = renderIcon(VscFileCode, "text-[#7f8ea3]");
const folderIcon = renderIcon(VscFolder, "text-[#dcb67a]");
const folderOpenIcon = renderIcon(VscFolderOpened, "text-[#dcb67a]");
const envIcon = renderIcon(VscSettingsGear, "text-[#9aa4b2]");
const nextIcon = renderIcon(SiNextdotjs, "text-foreground");
const nodeIcon = renderIcon(SiNodedotjs, "text-[#5fa04e]");

const FILE_NAME_ICONS: Record<string, IconRenderer> = {
  ".gitignore": renderIcon(SiGit, "text-[#f1502f]"),
  ".gitattributes": renderIcon(SiGit, "text-[#f1502f]"),
  "dockerfile": renderIcon(SiDocker, "text-[#2496ed]"),
  "package-lock.json": renderIcon(SiNpm, "text-[#cb3837]"),
  "package.json": renderIcon(SiNpm, "text-[#cb3837]"),
  "pnpm-lock.yaml": renderIcon(SiPnpm, "text-[#f69220]"),
  "postcss.config.js": renderIcon(SiPostcss, "text-[#dd3a0a]"),
  "postcss.config.mjs": renderIcon(SiPostcss, "text-[#dd3a0a]"),
  "postcss.config.ts": renderIcon(SiPostcss, "text-[#dd3a0a]"),
  "tailwind.config.js": renderIcon(SiTailwindcss, "text-[#06b6d4]"),
  "tailwind.config.mjs": renderIcon(SiTailwindcss, "text-[#06b6d4]"),
  "tailwind.config.ts": renderIcon(SiTailwindcss, "text-[#06b6d4]"),
  "tsconfig.json": renderIcon(SiTypescript, "text-[#3178c6]"),
  "vite.config.js": renderIcon(SiJavascript, "text-[#f7df1e]"),
  "vite.config.ts": renderIcon(SiTypescript, "text-[#3178c6]"),
  "vitest.config.ts": renderIcon(SiVitest, "text-[#6e9f18]"),
  "yarn.lock": renderIcon(SiYarn, "text-[#2c8ebb]"),
};

const FILE_EXTENSION_ICONS: Record<string, IconRenderer> = {
  bash: renderIcon(VscTerminalBash, "text-[#89e051]"),
  cjs: renderIcon(SiJavascript, "text-[#f7df1e]"),
  css: renderIcon(SiCss, "text-[#1572b6]"),
  env: envIcon,
  gif: renderIcon(VscFileMedia, "text-[#a5d6ff]"),
  gql: renderIcon(SiGraphql, "text-[#e10098]"),
  graphql: renderIcon(SiGraphql, "text-[#e10098]"),
  html: renderIcon(SiHtml5, "text-[#e34f26]"),
  ico: renderIcon(VscFileMedia, "text-[#a5d6ff]"),
  jpeg: renderIcon(VscFileMedia, "text-[#a5d6ff]"),
  jpg: renderIcon(VscFileMedia, "text-[#a5d6ff]"),
  js: renderIcon(SiJavascript, "text-[#f7df1e]"),
  json: renderIcon(VscJson, "text-[#f1c40f]"),
  jsonc: renderIcon(VscJson, "text-[#f1c40f]"),
  jsx: renderIcon(SiReact, "text-[#61dafb]"),
  less: renderIcon(SiCss, "text-[#1d365d]"),
  md: renderIcon(VscMarkdown, "text-[#42a5f5]"),
  mdx: renderIcon(SiMdx, "text-[#1b73ba]"),
  mjs: renderIcon(SiJavascript, "text-[#f7df1e]"),
  png: renderIcon(VscFileMedia, "text-[#a5d6ff]"),
  postcss: renderIcon(SiPostcss, "text-[#dd3a0a]"),
  prisma: renderIcon(SiPrisma, "text-[#5a67d8]"),
  py: renderIcon(SiPython, "text-[#3776ab]"),
  rs: renderIcon(SiRust, "text-[#dea584]"),
  sh: renderIcon(VscTerminalBash, "text-[#89e051]"),
  sql: renderIcon(SiSqlite, "text-[#0f80cc]"),
  svg: renderIcon(SiSvg, "text-[#ffb13b]"),
  toml: renderIcon(SiToml, "text-[#9c4221]"),
  ts: renderIcon(SiTypescript, "text-[#3178c6]"),
  tsx: renderIcon(SiReact, "text-[#61dafb]"),
  txt: defaultFileIcon,
  webp: renderIcon(VscFileMedia, "text-[#a5d6ff]"),
  xml: defaultCodeIcon,
  yaml: renderIcon(SiYaml, "text-[#cb171e]"),
  yml: renderIcon(SiYaml, "text-[#cb171e]"),
};

const NEXT_CONFIG_FILES = new Set([
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
]);

const NODE_FILES = new Set([
  ".nvmrc",
  ".node-version",
]);

const resolveFileIcon = (
  name: string,
  allowPartialExtensionMatch: boolean,
) => {
  const normalizedName = name.trim().toLowerCase();

  if (!normalizedName) {
    return defaultFileIcon;
  }

  if (normalizedName.startsWith(".env")) {
    return envIcon;
  }

  if (NEXT_CONFIG_FILES.has(normalizedName)) {
    return nextIcon;
  }

  if (NODE_FILES.has(normalizedName)) {
    return nodeIcon;
  }

  const directIcon = FILE_NAME_ICONS[normalizedName];
  if (directIcon) {
    return directIcon;
  }

  const extensionIndex = normalizedName.lastIndexOf(".");
  if (extensionIndex < 0 || extensionIndex === normalizedName.length - 1) {
    return defaultFileIcon;
  }

  const extension = normalizedName.slice(extensionIndex + 1);
  const exactMatch = FILE_EXTENSION_ICONS[extension];
  if (exactMatch) {
    return exactMatch;
  }

  if (allowPartialExtensionMatch) {
    const partialMatch = Object.entries(FILE_EXTENSION_ICONS).find(
      ([knownExtension]) => knownExtension.startsWith(extension),
    );

    if (partialMatch) {
      return partialMatch[1];
    }
  }

  return defaultCodeIcon;
};

export const ItemIcon = ({
  type,
  name,
  isOpen,
  className,
  allowPartialFileMatch = false,
}: {
  type: "file" | "folder";
  name?: string;
  isOpen?: boolean;
  className?: string;
  allowPartialFileMatch?: boolean;
}) => {
  if (type === "folder") {
    return (isOpen ? folderOpenIcon : folderIcon)(className);
  }

  return resolveFileIcon(name ?? "", allowPartialFileMatch)(className);
};
