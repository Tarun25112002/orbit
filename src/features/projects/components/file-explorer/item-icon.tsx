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
const toneStrong = "text-foreground/90";
const toneMedium = "text-foreground/75";
const toneMuted = "text-muted-foreground";
const toneSoft = "text-muted-foreground/85";
const toneSubtle = "text-muted-foreground/70";

const renderIcon = (Icon: ElementType, defaultClassName: string): IconRenderer => {
  function NamedIconRenderer(className?: string) {
    return (
      <Icon className={cn("size-4 shrink-0", defaultClassName, className)} />
    );
  }

  return NamedIconRenderer;
};

const defaultFileIcon = renderIcon(FileIcon, toneMuted);
const defaultCodeIcon = renderIcon(VscFileCode, toneMedium);
const folderIcon = renderIcon(VscFolder, toneMedium);
const folderOpenIcon = renderIcon(VscFolderOpened, toneMedium);
const envIcon = renderIcon(VscSettingsGear, toneSoft);
const nextIcon = renderIcon(SiNextdotjs, toneStrong);
const nodeIcon = renderIcon(SiNodedotjs, toneMedium);

const FILE_NAME_ICONS: Record<string, IconRenderer> = {
  ".gitignore": renderIcon(SiGit, toneMedium),
  ".gitattributes": renderIcon(SiGit, toneMedium),
  "dockerfile": renderIcon(SiDocker, toneMedium),
  "package-lock.json": renderIcon(SiNpm, toneStrong),
  "package.json": renderIcon(SiNpm, toneStrong),
  "pnpm-lock.yaml": renderIcon(SiPnpm, toneStrong),
  "postcss.config.js": renderIcon(SiPostcss, toneMedium),
  "postcss.config.mjs": renderIcon(SiPostcss, toneMedium),
  "postcss.config.ts": renderIcon(SiPostcss, toneMedium),
  "tailwind.config.js": renderIcon(SiTailwindcss, toneMedium),
  "tailwind.config.mjs": renderIcon(SiTailwindcss, toneMedium),
  "tailwind.config.ts": renderIcon(SiTailwindcss, toneMedium),
  "tsconfig.json": renderIcon(SiTypescript, toneMedium),
  "vite.config.js": renderIcon(SiJavascript, toneMedium),
  "vite.config.ts": renderIcon(SiTypescript, toneMedium),
  "vitest.config.ts": renderIcon(SiVitest, toneMedium),
  "yarn.lock": renderIcon(SiYarn, toneStrong),
};

const FILE_EXTENSION_ICONS: Record<string, IconRenderer> = {
  bash: renderIcon(VscTerminalBash, toneMedium),
  cjs: renderIcon(SiJavascript, toneMedium),
  css: renderIcon(SiCss, toneMedium),
  env: envIcon,
  gif: renderIcon(VscFileMedia, toneSubtle),
  gql: renderIcon(SiGraphql, toneMedium),
  graphql: renderIcon(SiGraphql, toneMedium),
  html: renderIcon(SiHtml5, toneMedium),
  ico: renderIcon(VscFileMedia, toneSubtle),
  jpeg: renderIcon(VscFileMedia, toneSubtle),
  jpg: renderIcon(VscFileMedia, toneSubtle),
  js: renderIcon(SiJavascript, toneMedium),
  json: renderIcon(VscJson, toneMedium),
  jsonc: renderIcon(VscJson, toneMedium),
  jsx: renderIcon(SiReact, toneMedium),
  less: renderIcon(SiCss, toneMedium),
  md: renderIcon(VscMarkdown, toneMedium),
  mdx: renderIcon(SiMdx, toneMedium),
  mjs: renderIcon(SiJavascript, toneMedium),
  png: renderIcon(VscFileMedia, toneSubtle),
  postcss: renderIcon(SiPostcss, toneMedium),
  prisma: renderIcon(SiPrisma, toneMedium),
  py: renderIcon(SiPython, toneMedium),
  rs: renderIcon(SiRust, toneMedium),
  sh: renderIcon(VscTerminalBash, toneMedium),
  sql: renderIcon(SiSqlite, toneMedium),
  svg: renderIcon(SiSvg, toneMedium),
  toml: renderIcon(SiToml, toneMedium),
  ts: renderIcon(SiTypescript, toneMedium),
  tsx: renderIcon(SiReact, toneMedium),
  txt: defaultFileIcon,
  webp: renderIcon(VscFileMedia, toneSubtle),
  xml: defaultCodeIcon,
  yaml: renderIcon(SiYaml, toneMedium),
  yml: renderIcon(SiYaml, toneMedium),
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
