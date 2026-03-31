import type { Extension } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";

const EXTENSION_MAP: Record<string, () => Extension> = {
  js: () => javascript(),
  mjs: () => javascript(),
  cjs: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  html: () => html(),
  htm: () => html(),
  css: () => css(),
  less: () => css(),
  scss: () => css(),
  json: () => json(),
  jsonc: () => json(),
  md: () => markdown(),
  mdx: () => markdown(),
  py: () => python(),
  rs: () => rust(),
  sql: () => sql(),
  xml: () => xml(),
  svg: () => xml(),
  yaml: () => yaml(),
  yml: () => yaml(),
};

const FILENAME_MAP: Record<string, () => Extension> = {
  ".gitignore": () => javascript(),
  ".env": () => javascript(),
  ".env.local": () => javascript(),
  ".env.development": () => javascript(),
  ".env.production": () => javascript(),
  "dockerfile": () => javascript(),
  "tsconfig.json": () => json(),
  "package.json": () => json(),
};

export const getLanguageExtension = (filename: string): Extension[] => {
  const normalizedName = filename.trim().toLowerCase();

  // Check exact filename matches first
  const filenameMatch = FILENAME_MAP[normalizedName];
  if (filenameMatch) return [filenameMatch()];

  // Check for .env.* pattern
  if (normalizedName.startsWith(".env")) {
    return [javascript()];
  }

  // Check extension
  const dotIndex = normalizedName.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === normalizedName.length - 1) return [];

  const ext = normalizedName.slice(dotIndex + 1);
  const extMatch = EXTENSION_MAP[ext];
  if (extMatch) return [extMatch()];

  return [];
};
