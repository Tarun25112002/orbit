const EXTENSION_TO_MONACO_LANGUAGE: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  html: "html",
  htm: "html",
  xhtml: "html",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "less",
  vue: "html",
  json: "json",
  jsonc: "json",
  json5: "json",
  md: "markdown",
  mdx: "markdown",
  yaml: "yaml",
  yml: "yaml",
  xml: "xml",
  svg: "xml",
  xsl: "xml",
  xslt: "xml",
  py: "python",
  pyw: "python",
  pyi: "python",
  rs: "rust",
  c: "c",
  h: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  cc: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  hh: "cpp",
  java: "java",
  go: "go",
  php: "php",
  sql: "sql",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  ps1: "powershell",
  dockerfile: "dockerfile",
  graphql: "graphql",
  gql: "graphql",
  prisma: "plaintext",
  proto: "protobuf",
  tf: "hcl",
  hcl: "hcl",
  env: "shell",
  log: "plaintext",
  diff: "diff",
  patch: "diff",
};

const FILENAME_TO_MONACO_LANGUAGE: Record<string, string> = {
  dockerfile: "dockerfile",
  "docker-compose.yml": "yaml",
  "docker-compose.yaml": "yaml",
  makefile: "plaintext",
  "tsconfig.json": "json",
  "jsconfig.json": "json",
  "package.json": "json",
  "package-lock.json": "json",
  "composer.json": "json",
  "tailwind.config.js": "javascript",
  "tailwind.config.ts": "typescript",
  "next.config.js": "javascript",
  "next.config.mjs": "javascript",
  "next.config.ts": "typescript",
  "vite.config.ts": "typescript",
  "vitest.config.ts": "typescript",
  "postcss.config.js": "javascript",
  "postcss.config.mjs": "javascript",
  "webpack.config.js": "javascript",
  "rollup.config.js": "javascript",
  "cargo.toml": "toml",
  "cargo.lock": "toml",
  "go.mod": "go",
  "go.sum": "go",
  gemfile: "ruby",
  rakefile: "ruby",
  vagrantfile: "ruby",
  jenkinsfile: "groovy",
  ".gitignore": "plaintext",
  ".gitattributes": "plaintext",
  ".editorconfig": "ini",
  ".prettierrc": "json",
  ".eslintrc": "json",
  ".babelrc": "json",
};

const EXTENSION_TO_LANGUAGE_NAME: Record<string, string> = {
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
  pyi: "Python",
  rs: "Rust",
  c: "C",
  h: "C/C++ Header",
  cpp: "C++",
  cxx: "C++",
  cc: "C++",
  hpp: "C++ Header",
  hxx: "C++ Header",
  hh: "C++ Header",
  java: "Java",
  go: "Go",
  php: "PHP",
  sql: "SQL",
  sh: "Shell Script",
  bash: "Shell Script",
  zsh: "Shell Script",
  fish: "Shell Script",
  ps1: "PowerShell",
  dockerfile: "Dockerfile",
  graphql: "GraphQL",
  gql: "GraphQL",
  prisma: "Prisma",
  proto: "Protocol Buffers",
  tf: "Terraform",
  hcl: "HCL",
  env: "Environment",
  log: "Log",
  diff: "Diff",
  patch: "Patch",
};

const FILENAME_TO_LANGUAGE_NAME: Record<string, string> = {
  dockerfile: "Dockerfile",
  makefile: "Makefile",
  gemfile: "Ruby",
  rakefile: "Ruby",
  vagrantfile: "Ruby",
  jenkinsfile: "Groovy",
};

export const getMonacoLanguage = (filename: string): string => {
  const normalizedName = filename.trim().toLowerCase();

  if (normalizedName.endsWith(".component.html")) {
    return "html";
  }

  if (normalizedName.startsWith(".env")) {
    return "shell";
  }

  const fileMatch = FILENAME_TO_MONACO_LANGUAGE[normalizedName];
  if (fileMatch) {
    return fileMatch;
  }

  const dotIndex = normalizedName.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === normalizedName.length - 1) {
    return "plaintext";
  }

  const ext = normalizedName.slice(dotIndex + 1);
  return EXTENSION_TO_MONACO_LANGUAGE[ext] ?? "plaintext";
};

export const getLanguageName = (filename: string): string => {
  const normalizedName = filename.trim().toLowerCase();

  if (normalizedName.endsWith(".component.html")) {
    return "Angular Template";
  }

  const fileMatch = FILENAME_TO_LANGUAGE_NAME[normalizedName];
  if (fileMatch) {
    return fileMatch;
  }

  const dotIndex = normalizedName.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === normalizedName.length - 1) {
    return "Plain Text";
  }

  const ext = normalizedName.slice(dotIndex + 1);
  return EXTENSION_TO_LANGUAGE_NAME[ext] ?? "Plain Text";
};
