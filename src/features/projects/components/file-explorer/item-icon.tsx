import type { ElementType, ReactElement } from "react";
import { FileIcon } from "lucide-react";
import {
  VscFileCode,
  VscFileMedia,
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
import {
  TbFolder,
  TbFolderBolt,
  TbFolderCheck,
  TbFolderCode,
  TbFolderCog,
  TbFolderOpen,
  TbFolderRoot,
} from "react-icons/tb";

import { cn } from "@/lib/utils";

type IconRenderer = (className?: string) => ReactElement;
type FolderIconSet = {
  closed: IconRenderer;
  open: IconRenderer;
};
const toneDefault = "text-muted-foreground";
const toneSubtle = "text-muted-foreground/80";
const colorBash = "text-[#8fcf7a]";
const colorCss = "text-[#86bafc]";
const colorDocker = "text-[#7cb8f9]";
const colorEnv = "text-[#a6b0c5]";
const colorFolder = "text-[#dcb67a]";
const colorFolderAutomation = "text-[#e2b26f]";
const colorFolderCode = "text-[#92b4ff]";
const colorFolderConfig = "text-[#b2a3ff]";
const colorGit = "text-[#f59563]";
const colorFolderRoot = "text-[#e7c981]";
const colorFolderTest = "text-[#93d39e]";
const colorGraphql = "text-[#e590d0]";
const colorHtml = "text-[#f39c6b]";
const colorJavascript = "text-[#f7de6d]";
const colorJson = "text-[#cb9e72]";
const colorMarkdown = "text-[#7aa2f7]";
const colorNext = "text-[#d8dee9]";
const colorNode = "text-[#8fcf7a]";
const colorNpm = "text-[#ef7d7d]";
const colorPnpm = "text-[#f2b56b]";
const colorPostCss = "text-[#86bafc]";
const colorPrisma = "text-[#8fa8d6]";
const colorPython = "text-[#f7d06a]";
const colorReact = "text-[#7ad8f5]";
const colorRust = "text-[#d0a989]";
const colorSql = "text-[#8ab4f8]";
const colorSvg = "text-[#f0c778]";
const colorTailwind = "text-[#7ad8f5]";
const colorToml = "text-[#b6becf]";
const colorTypescript = "text-[#4aa4f4]";
const colorYaml = "text-[#d7ba7d]";
const colorYarn = "text-[#7ad0dd]";

const renderIcon = (Icon: ElementType, defaultClassName: string): IconRenderer => {
  function NamedIconRenderer(className?: string) {
    return (
      <Icon className={cn("size-4 shrink-0", defaultClassName, className)} />
    );
  }

  return NamedIconRenderer;
};

const defaultFileIcon = renderIcon(FileIcon, toneDefault);
const defaultCodeIcon = renderIcon(VscFileCode, colorMarkdown);
const envIcon = renderIcon(VscSettingsGear, colorEnv);
const nextIcon = renderIcon(SiNextdotjs, colorNext);
const nodeIcon = renderIcon(SiNodedotjs, colorNode);
const renderFolderSet = (
  ClosedIcon: ElementType,
  defaultClassName: string,
): FolderIconSet => ({
  closed: renderIcon(ClosedIcon, defaultClassName),
  open: renderIcon(TbFolderOpen, defaultClassName),
});
const folderIcons = renderFolderSet(TbFolder, colorFolder);
const codeFolderIcons = renderFolderSet(TbFolderCode, colorFolderCode);
const configFolderIcons = renderFolderSet(TbFolderCog, colorFolderConfig);
const gitFolderIcons = renderFolderSet(TbFolder, colorGit);
const automationFolderIcons = renderFolderSet(
  TbFolderBolt,
  colorFolderAutomation,
);
const testingFolderIcons = renderFolderSet(TbFolderCheck, colorFolderTest);
const rootFolderIcons = renderFolderSet(TbFolderRoot, colorFolderRoot);

const FILE_NAME_ICONS: Record<string, IconRenderer> = {
  ".gitignore": renderIcon(SiGit, colorGit),
  ".gitattributes": renderIcon(SiGit, colorGit),
  "bun.lockb": renderIcon(SiNpm, colorNpm),
  "dockerfile": renderIcon(SiDocker, colorDocker),
  "license": renderIcon(FileIcon, colorMarkdown),
  "package-lock.json": renderIcon(SiNpm, colorNpm),
  "package.json": renderIcon(SiNpm, colorNpm),
  "pnpm-lock.yaml": renderIcon(SiPnpm, colorPnpm),
  "postcss.config.js": renderIcon(SiPostcss, colorPostCss),
  "postcss.config.mjs": renderIcon(SiPostcss, colorPostCss),
  "postcss.config.ts": renderIcon(SiPostcss, colorPostCss),
  "tailwind.config.js": renderIcon(SiTailwindcss, colorTailwind),
  "tailwind.config.mjs": renderIcon(SiTailwindcss, colorTailwind),
  "tailwind.config.ts": renderIcon(SiTailwindcss, colorTailwind),
  "tsconfig.json": renderIcon(SiTypescript, colorTypescript),
  "vite.config.js": renderIcon(SiJavascript, colorJavascript),
  "vite.config.ts": renderIcon(SiTypescript, colorTypescript),
  "vitest.config.ts": renderIcon(SiVitest, colorTypescript),
  "yarn.lock": renderIcon(SiYarn, colorYarn),
  "readme.md": renderIcon(VscMarkdown, colorMarkdown),
};

const FILE_EXTENSION_ICONS: Record<string, IconRenderer> = {
  bash: renderIcon(VscTerminalBash, colorBash),
  cjs: renderIcon(SiJavascript, colorJavascript),
  css: renderIcon(SiCss, colorCss),
  env: envIcon,
  gif: renderIcon(VscFileMedia, toneSubtle),
  gql: renderIcon(SiGraphql, colorGraphql),
  graphql: renderIcon(SiGraphql, colorGraphql),
  html: renderIcon(SiHtml5, colorHtml),
  ico: renderIcon(VscFileMedia, toneSubtle),
  jpeg: renderIcon(VscFileMedia, toneSubtle),
  jpg: renderIcon(VscFileMedia, toneSubtle),
  js: renderIcon(SiJavascript, colorJavascript),
  json: renderIcon(VscJson, colorJson),
  jsonc: renderIcon(VscJson, colorJson),
  jsx: renderIcon(SiReact, colorReact),
  less: renderIcon(SiCss, colorCss),
  md: renderIcon(VscMarkdown, colorMarkdown),
  mdx: renderIcon(SiMdx, colorMarkdown),
  mjs: renderIcon(SiJavascript, colorJavascript),
  png: renderIcon(VscFileMedia, toneSubtle),
  postcss: renderIcon(SiPostcss, colorPostCss),
  prisma: renderIcon(SiPrisma, colorPrisma),
  py: renderIcon(SiPython, colorPython),
  rs: renderIcon(SiRust, colorRust),
  sh: renderIcon(VscTerminalBash, colorBash),
  sql: renderIcon(SiSqlite, colorSql),
  svg: renderIcon(SiSvg, colorSvg),
  toml: renderIcon(SiToml, colorToml),
  ts: renderIcon(SiTypescript, colorTypescript),
  tsx: renderIcon(SiReact, colorReact),
  txt: defaultFileIcon,
  webp: renderIcon(VscFileMedia, toneSubtle),
  xml: defaultCodeIcon,
  yaml: renderIcon(SiYaml, colorYaml),
  yml: renderIcon(SiYaml, colorYaml),
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
const FOLDER_NAME_ICONS: Record<string, FolderIconSet> = {
  ".git": gitFolderIcons,
  ".github": gitFolderIcons,
  ".husky": configFolderIcons,
  ".vscode": configFolderIcons,
  "api": automationFolderIcons,
  "app": codeFolderIcons,
  "components": codeFolderIcons,
  "config": configFolderIcons,
  "configs": configFolderIcons,
  "e2e": testingFolderIcons,
  "features": codeFolderIcons,
  "hooks": codeFolderIcons,
  "lib": codeFolderIcons,
  "pages": codeFolderIcons,
  "scripts": automationFolderIcons,
  "server": automationFolderIcons,
  "src": rootFolderIcons,
  "spec": testingFolderIcons,
  "specs": testingFolderIcons,
  "test": testingFolderIcons,
  "tests": testingFolderIcons,
  "types": codeFolderIcons,
  "utils": codeFolderIcons,
  "workers": automationFolderIcons,
  "__tests__": testingFolderIcons,
};

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
const resolveFolderIcon = (name: string, isOpen: boolean) => {
  const normalizedName = name.trim().toLowerCase();
  const iconSet = FOLDER_NAME_ICONS[normalizedName] ?? folderIcons;

  return isOpen ? iconSet.open : iconSet.closed;
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
    return resolveFolderIcon(name ?? "", Boolean(isOpen))(className);
  }

  return resolveFileIcon(name ?? "", allowPartialFileMatch)(className);
};
