const DEFAULT_MONACO_LANGUAGE = "plaintext";
const DEFAULT_LANGUAGE_NAME = "Plain Text";

const EXTENSION_TO_MONACO_LANGUAGE: Record<string, string> = {
  bash: "shell",
  bat: "bat",
  c: "cpp",
  cc: "cpp",
  cjs: "javascript",
  cmd: "bat",
  conf: "ini",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  cts: "typescript",
  cxx: "cpp",
  dart: "dart",
  diff: "plaintext",
  dockerfile: "dockerfile",
  env: "shell",
  fish: "shell",
  fs: "fsharp",
  fsi: "fsharp",
  fsx: "fsharp",
  gql: "graphql",
  graphql: "graphql",
  go: "go",
  h: "cpp",
  hcl: "hcl",
  hh: "cpp",
  hpp: "cpp",
  htm: "html",
  html: "html",
  hxx: "cpp",
  ini: "ini",
  java: "java",
  js: "javascript",
  json: "json",
  json5: "json",
  jsonc: "json",
  jsx: "javascript",
  kt: "kotlin",
  kts: "kotlin",
  less: "less",
  liquid: "liquid",
  log: "plaintext",
  lua: "lua",
  md: "markdown",
  mdx: "mdx",
  mjs: "javascript",
  mts: "typescript",
  mysql: "mysql",
  patch: "plaintext",
  phtml: "php",
  php: "php",
  pl: "perl",
  pm: "perl",
  prisma: "plaintext",
  properties: "ini",
  proto: "protobuf",
  ps1: "powershell",
  psd1: "powershell",
  psm1: "powershell",
  psql: "pgsql",
  py: "python",
  pyi: "python",
  pyw: "python",
  r: "r",
  rb: "ruby",
  rs: "rust",
  sass: "scss",
  sc: "scala",
  scala: "scala",
  scss: "scss",
  sh: "shell",
  sol: "solidity",
  sql: "sql",
  svg: "xml",
  swift: "swift",
  tf: "hcl",
  toml: "ini",
  ts: "typescript",
  tsv: "plaintext",
  tsx: "typescript",
  twig: "twig",
  txt: "plaintext",
  vue: "html",
  xhtml: "html",
  xml: "xml",
  xsl: "xml",
  xslt: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "shell",
};

const FILENAME_TO_MONACO_LANGUAGE: Record<string, string> = {
  ".babelrc": "json",
  ".bash_profile": "shell",
  ".bashrc": "shell",
  ".dockerignore": "plaintext",
  ".editorconfig": "ini",
  ".eslintrc": "json",
  ".gitattributes": "plaintext",
  ".gitignore": "plaintext",
  ".npmrc": "ini",
  ".prettierrc": "json",
  ".profile": "shell",
  ".yarnrc": "ini",
  ".zshrc": "shell",
  brewfile: "ruby",
  "cargo.lock": "ini",
  "cargo.toml": "ini",
  compose: "yaml",
  "compose.yaml": "yaml",
  "compose.yml": "yaml",
  "composer.json": "json",
  dockerfile: "dockerfile",
  "docker-compose.yaml": "yaml",
  "docker-compose.yml": "yaml",
  "eslint.config.cjs": "javascript",
  "eslint.config.js": "javascript",
  "eslint.config.mjs": "javascript",
  "eslint.config.ts": "typescript",
  gemfile: "ruby",
  "go.mod": "go",
  "go.sum": "go",
  "jsconfig.json": "json",
  jenkinsfile: "plaintext",
  makefile: "shell",
  "next.config.cjs": "javascript",
  "next.config.js": "javascript",
  "next.config.mjs": "javascript",
  "next.config.ts": "typescript",
  "package-lock.json": "json",
  "package.json": "json",
  "pnpm-lock.yaml": "yaml",
  "postcss.config.cjs": "javascript",
  "postcss.config.js": "javascript",
  "postcss.config.mjs": "javascript",
  "postcss.config.ts": "typescript",
  "prettier.config.cjs": "javascript",
  "prettier.config.js": "javascript",
  "prettier.config.mjs": "javascript",
  "prettier.config.ts": "typescript",
  rakefile: "ruby",
  "rollup.config.js": "javascript",
  "rollup.config.mjs": "javascript",
  "rollup.config.ts": "typescript",
  "tailwind.config.cjs": "javascript",
  "tailwind.config.js": "javascript",
  "tailwind.config.mjs": "javascript",
  "tailwind.config.ts": "typescript",
  "tsconfig.json": "json",
  vagrantfile: "ruby",
  "vite.config.js": "javascript",
  "vite.config.ts": "typescript",
  "vitest.config.js": "javascript",
  "vitest.config.ts": "typescript",
  "webpack.config.cjs": "javascript",
  "webpack.config.js": "javascript",
  "webpack.config.mjs": "javascript",
  "webpack.config.ts": "typescript",
  "yarn.lock": "plaintext",
};

const EXTENSION_TO_LANGUAGE_NAME: Record<string, string> = {
  bash: "Shell Script",
  bat: "Batch",
  c: "C/C++",
  cc: "C++",
  cjs: "JavaScript",
  cmd: "Batch",
  conf: "Config",
  cpp: "C++",
  cs: "C#",
  css: "CSS",
  cts: "TypeScript",
  cxx: "C++",
  dart: "Dart",
  diff: "Diff",
  dockerfile: "Dockerfile",
  env: "Environment",
  fish: "Shell Script",
  fs: "F#",
  fsi: "F#",
  fsx: "F#",
  gql: "GraphQL",
  graphql: "GraphQL",
  go: "Go",
  h: "C/C++ Header",
  hcl: "HCL",
  hh: "C++ Header",
  hpp: "C++ Header",
  htm: "HTML",
  html: "HTML",
  hxx: "C++ Header",
  ini: "INI",
  java: "Java",
  js: "JavaScript",
  json: "JSON",
  json5: "JSON5",
  jsonc: "JSON with Comments",
  jsx: "JavaScript JSX",
  kt: "Kotlin",
  kts: "Kotlin",
  less: "Less",
  liquid: "Liquid",
  log: "Log",
  lua: "Lua",
  md: "Markdown",
  mdx: "MDX",
  mjs: "JavaScript",
  mts: "TypeScript",
  mysql: "MySQL",
  patch: "Patch",
  phtml: "PHP",
  php: "PHP",
  pl: "Perl",
  pm: "Perl",
  prisma: "Prisma",
  properties: "Properties",
  proto: "Protocol Buffers",
  ps1: "PowerShell",
  psd1: "PowerShell",
  psm1: "PowerShell",
  psql: "PostgreSQL",
  py: "Python",
  pyi: "Python",
  pyw: "Python",
  r: "R",
  rb: "Ruby",
  rs: "Rust",
  sass: "Sass",
  sc: "Scala",
  scala: "Scala",
  scss: "SCSS",
  sh: "Shell Script",
  sol: "Solidity",
  sql: "SQL",
  svg: "SVG",
  swift: "Swift",
  tf: "Terraform",
  toml: "TOML",
  ts: "TypeScript",
  tsv: "TSV",
  tsx: "TypeScript JSX",
  twig: "Twig",
  txt: "Plain Text",
  vue: "Vue",
  xhtml: "HTML",
  xml: "XML",
  xsl: "XSL",
  xslt: "XSLT",
  yaml: "YAML",
  yml: "YAML",
  zsh: "Shell Script",
};

const FILENAME_TO_LANGUAGE_NAME: Record<string, string> = {
  ".babelrc": "Babel Config",
  ".bash_profile": "Shell Script",
  ".bashrc": "Shell Script",
  ".dockerignore": "Plain Text",
  ".editorconfig": "EditorConfig",
  ".eslintrc": "ESLint Config",
  ".gitattributes": "Git Attributes",
  ".gitignore": "Git Ignore",
  ".npmrc": "NPM Config",
  ".prettierrc": "Prettier Config",
  ".profile": "Shell Script",
  ".yarnrc": "Yarn Config",
  ".zshrc": "Shell Script",
  brewfile: "Ruby",
  dockerfile: "Dockerfile",
  gemfile: "Ruby",
  jenkinsfile: "Jenkinsfile",
  makefile: "Makefile",
  rakefile: "Ruby",
  vagrantfile: "Ruby",
};

const normalizeFilename = (filename: string) =>
  filename.trim().replace(/\\/g, "/").toLowerCase();

const getBaseName = (normalizedPath: string) => {
  const segments = normalizedPath.split("/");
  return segments[segments.length - 1] ?? normalizedPath;
};

const getExtension = (basename: string) => {
  const dotIndex = basename.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === basename.length - 1) {
    return null;
  }

  return basename.slice(dotIndex + 1);
};

const isEnvFile = (basename: string) =>
  basename === ".env" || basename.startsWith(".env.");

const isAngularTemplate = (basename: string) =>
  basename.endsWith(".component.html");

export const getMonacoLanguage = (filename: string): string => {
  const normalizedName = normalizeFilename(filename);
  const basename = getBaseName(normalizedName);

  if (isAngularTemplate(basename)) {
    return "html";
  }

  if (isEnvFile(basename)) {
    return "shell";
  }

  const fileMatch = FILENAME_TO_MONACO_LANGUAGE[basename];
  if (fileMatch) {
    return fileMatch;
  }

  const ext = getExtension(basename);
  if (!ext) {
    return DEFAULT_MONACO_LANGUAGE;
  }

  return EXTENSION_TO_MONACO_LANGUAGE[ext] ?? DEFAULT_MONACO_LANGUAGE;
};

export const getLanguageName = (filename: string): string => {
  const normalizedName = normalizeFilename(filename);
  const basename = getBaseName(normalizedName);

  if (isAngularTemplate(basename)) {
    return "Angular Template";
  }

  if (isEnvFile(basename)) {
    return "Environment Variables";
  }

  const fileMatch = FILENAME_TO_LANGUAGE_NAME[basename];
  if (fileMatch) {
    return fileMatch;
  }

  const ext = getExtension(basename);
  if (!ext) {
    return DEFAULT_LANGUAGE_NAME;
  }

  return EXTENSION_TO_LANGUAGE_NAME[ext] ?? DEFAULT_LANGUAGE_NAME;
};
