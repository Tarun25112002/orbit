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
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { php } from "@codemirror/lang-php";
import { go } from "@codemirror/lang-go";
import { sass } from "@codemirror/lang-sass";
import { less } from "@codemirror/lang-less";
import { vue } from "@codemirror/lang-vue";
import { angular } from "@codemirror/lang-angular";
import { liquid } from "@codemirror/lang-liquid";
import { wast } from "@codemirror/lang-wast";

// ── Extension-based language map ────────────────────────────────
const EXTENSION_MAP: Record<string, () => Extension> = {
  // JavaScript / TypeScript
  js: () => javascript(),
  mjs: () => javascript(),
  cjs: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  mts: () => javascript({ typescript: true }),
  cts: () => javascript({ typescript: true }),

  // Web
  html: () => html(),
  htm: () => html(),
  xhtml: () => html(),
  css: () => css(),
  scss: () => sass({ indented: false }),
  sass: () => sass({ indented: true }),
  less: () => less(),
  vue: () => vue(),

  // Data / config
  json: () => json(),
  jsonc: () => json(),
  json5: () => json(),
  md: () => markdown(),
  mdx: () => markdown(),
  yaml: () => yaml(),
  yml: () => yaml(),
  xml: () => xml(),
  svg: () => xml(),
  xsl: () => xml(),
  xslt: () => xml(),
  toml: () => yaml(), // close-enough highlighting
  ini: () => yaml(),
  cfg: () => yaml(),
  conf: () => yaml(),
  properties: () => yaml(),

  // Systems
  py: () => python(),
  pyw: () => python(),
  pyi: () => python(),
  rs: () => rust(),

  // C family
  c: () => cpp(),
  h: () => cpp(),
  cpp: () => cpp(),
  cxx: () => cpp(),
  cc: () => cpp(),
  hpp: () => cpp(),
  hxx: () => cpp(),
  hh: () => cpp(),

  // JVM
  java: () => java(),

  // Go
  go: () => go(),

  // PHP
  php: () => php(),

  // SQL
  sql: () => sql(),

  // WebAssembly
  wast: () => wast(),
  wat: () => wast(),

  // Angular templates
  "component.html": () => angular(),

  // Liquid
  liquid: () => liquid(),

  // Shell (use javascript for basic highlighting)
  sh: () => javascript(),
  bash: () => javascript(),
  zsh: () => javascript(),
  fish: () => javascript(),
  ps1: () => javascript(),

  // Misc
  graphql: () => javascript(),
  gql: () => javascript(),
  prisma: () => javascript(),
  proto: () => javascript(),
  tf: () => javascript(),
  hcl: () => javascript(),
  env: () => javascript(),
  log: () => javascript(),
  diff: () => javascript(),
  patch: () => javascript(),
};

// ── Exact filename matches ──────────────────────────────────────
const FILENAME_MAP: Record<string, () => Extension> = {
  ".gitignore": () => javascript(),
  ".gitattributes": () => javascript(),
  ".editorconfig": () => yaml(),
  ".prettierrc": () => json(),
  ".eslintrc": () => json(),
  ".babelrc": () => json(),
  ".env": () => javascript(),
  ".env.local": () => javascript(),
  ".env.development": () => javascript(),
  ".env.production": () => javascript(),
  ".env.test": () => javascript(),
  ".env.staging": () => javascript(),
  dockerfile: () => javascript(),
  "docker-compose.yml": () => yaml(),
  "docker-compose.yaml": () => yaml(),
  makefile: () => javascript(),
  "tsconfig.json": () => json(),
  "jsconfig.json": () => json(),
  "package.json": () => json(),
  "package-lock.json": () => json(),
  "composer.json": () => json(),
  "tailwind.config.js": () => javascript(),
  "tailwind.config.ts": () => javascript({ typescript: true }),
  "next.config.js": () => javascript(),
  "next.config.mjs": () => javascript(),
  "next.config.ts": () => javascript({ typescript: true }),
  "vite.config.ts": () => javascript({ typescript: true }),
  "vitest.config.ts": () => javascript({ typescript: true }),
  "postcss.config.js": () => javascript(),
  "postcss.config.mjs": () => javascript(),
  "webpack.config.js": () => javascript(),
  "rollup.config.js": () => javascript(),
  "cargo.toml": () => yaml(),
  "cargo.lock": () => yaml(),
  "go.mod": () => go(),
  "go.sum": () => go(),
  gemfile: () => javascript(),
  rakefile: () => javascript(),
  vagrantfile: () => javascript(),
  jenkinsfile: () => javascript(),
};

/**
 * Detects the programming language from a filename and returns
 * the appropriate CodeMirror language extension(s).
 */
export const getLanguageExtension = (filename: string): Extension[] => {
  const normalizedName = filename.trim().toLowerCase();

  // Angular templates are usually named *.component.html
  if (normalizedName.endsWith(".component.html")) {
    return [angular()];
  }

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

/**
 * Returns a human-readable language name for display in the status bar.
 */
export const getLanguageName = (filename: string): string => {
  const normalizedName = filename.trim().toLowerCase();

  if (normalizedName.endsWith(".component.html")) {
    return "Angular Template";
  }

  const dotIndex = normalizedName.lastIndexOf(".");
  if (dotIndex < 0) {
    // Check known filenames without extensions
    const knownNames: Record<string, string> = {
      dockerfile: "Dockerfile",
      makefile: "Makefile",
      gemfile: "Ruby",
      rakefile: "Ruby",
      vagrantfile: "Ruby",
      jenkinsfile: "Groovy",
    };
    return knownNames[normalizedName] ?? "Plain Text";
  }

  const ext = normalizedName.slice(dotIndex + 1);
  const langNames: Record<string, string> = {
    js: "JavaScript",
    mjs: "JavaScript",
    cjs: "JavaScript",
    jsx: "JavaScript JSX",
    ts: "TypeScript",
    tsx: "TypeScript JSX",
    mts: "TypeScript",
    cts: "TypeScript",
    html: "HTML",
    htm: "HTML",
    css: "CSS",
    scss: "SCSS",
    sass: "Sass",
    less: "Less",
    vue: "Vue",
    json: "JSON",
    jsonc: "JSON with Comments",
    json5: "JSON5",
    md: "Markdown",
    mdx: "MDX",
    yaml: "YAML",
    yml: "YAML",
    xml: "XML",
    svg: "SVG",
    py: "Python",
    pyw: "Python",
    rs: "Rust",
    c: "C",
    h: "C/C++ Header",
    cpp: "C++",
    cxx: "C++",
    cc: "C++",
    hpp: "C++ Header",
    java: "Java",
    go: "Go",
    php: "PHP",
    sql: "SQL",
    sh: "Shell Script",
    bash: "Bash",
    zsh: "Zsh",
    ps1: "PowerShell",
    toml: "TOML",
    ini: "INI",
    graphql: "GraphQL",
    gql: "GraphQL",
    prisma: "Prisma",
    proto: "Protocol Buffers",
    diff: "Diff",
    log: "Log",
    env: "Environment Variables",
    liquid: "Liquid",
    wast: "WebAssembly",
  };

  return langNames[ext] ?? "Plain Text";
};
