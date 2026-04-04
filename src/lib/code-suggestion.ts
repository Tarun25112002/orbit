export type SuggestionMode = "autocomplete" | "transform";

export interface SuggestionProjectContextFile {
  path: string;
  content: string;
  score?: number;
  reason?: string;
}

export interface SuggestionProjectContext {
  activeFilePath?: string;
  workspaceSummary?: string;
  workspaceTree?: string;
  importHints?: string[];
  relatedFiles?: SuggestionProjectContextFile[];
}

export interface SuggestionRequestBody {
  mode?: SuggestionMode;
  fileName?: string;
  language?: string;
  code: string;
  lineNumber?: number;
  currentLine?: string;
  previousLines?: string;
  nextLines?: string;
  textBeforeCursor?: string;
  textAfterCursor?: string;
  cursorOffset?: number;
  selectedCode?: string;
  instruction?: string;
  selectionStartOffset?: number;
  selectionEndOffset?: number;
  projectContext?: SuggestionProjectContext;
}

export type SuggestionRequestStatus =
  | "queued"
  | "processing"
  | "retrying"
  | "completed"
  | "failed";

export interface SuggestionApiResponse {
  suggestion?: string;
  sugegstions?: string;
  error?: string;
  detail?: string;
  retryAfterSeconds?: number;
  run_id?: string;
  token?: string;
  requestId?: string;
  streamUrl?: string;
  pollUrl?: string;
  model?: string;
  mode?: SuggestionMode;
  execution?: "sync" | "inngest" | "cache";
  status?: SuggestionRequestStatus;
  attempt?: number;
  queuePosition?: number;
  cached?: boolean;
}
