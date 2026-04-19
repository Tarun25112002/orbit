"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import MonacoEditor, {
  type BeforeMount,
  type OnMount,
} from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { emmetCSS, emmetHTML, emmetJSX } from "emmet-monaco-es";
import { toast } from "sonner";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";

import {
  type CursorState,
  type EditorSettings,
} from "../store/use-editor-store";
import {
  getLanguageName,
  getMonacoLanguage,
} from "../utils/language-detection";
import { EditorContextMenu } from "./editor-context-menu";
import { EditorSelectionAiBar } from "./editor-selection-ai-bar";
import { getErrorMessage, getFriendlyErrorMessage } from "@/lib/errors";
import {
  type SuggestionApiResponse,
  type SuggestionRequestBody,
  type SuggestionProjectContext,
} from "@/lib/code-suggestion";
import { buildSuggestionProjectContext } from "../utils/codebase-context";

const DEFAULT_SETTINGS: EditorSettings = {
  wordWrap: false,
  minimap: true,
  fontSize: 13,
  tabSize: 2,
  insertSpaces: true,
  lineNumbers: "on",
  renderWhitespace: "none",
};

const EMMET_INIT_FLAG = "__orbit_monaco_emmet_initialized__";
const EMMET_HTML_LANGUAGES = [
  "html",
  "handlebars",
  "php",
  "razor",
  "twig",
  "xml",
];
const EMMET_CSS_LANGUAGES = ["css", "less", "scss"];
const EMMET_JSX_LANGUAGES = ["javascript", "typescript", "mdx"];
const EMMET_OPTIONS = { tokenizer: "standard" as const };
const ASYNC_SUGGESTION_POLL_INTERVAL_MS = 400;
const ASYNC_SUGGESTION_TIMEOUT_MS = 180_000;
const INLINE_SUGGESTION_LINE_WINDOW = 20;
const INLINE_SUGGESTION_CACHE_LIMIT = 30;
const INLINE_SUGGESTION_MIN_AUTOMATIC_PREFIX_CHARS = 3;
const INLINE_SUGGESTION_MIN_REQUEST_INTERVAL_MS = 1_200;
const INLINE_SUGGESTION_ERROR_TOAST_COOLDOWN_MS = 8_000;
const INLINE_SUGGESTION_PROVIDER_COOLDOWN_FALLBACK_MS = 30_000;
const INLINE_SUGGESTION_PROVIDER_RATE_LIMIT_PATTERN =
  /(free-models-per-(?:min|minute|day)|rate limit exceeded|too many requests)/i;

const initializeEmmet = (monacoApi: typeof Monaco) => {
  const globalState = globalThis as typeof globalThis & {
    [EMMET_INIT_FLAG]?: boolean;
  };

  if (globalState[EMMET_INIT_FLAG]) {
    return;
  }

  emmetHTML(monacoApi, EMMET_HTML_LANGUAGES, EMMET_OPTIONS);
  emmetCSS(monacoApi, EMMET_CSS_LANGUAGES, EMMET_OPTIONS);
  emmetJSX(monacoApi, EMMET_JSX_LANGUAGES, EMMET_OPTIONS);

  globalState[EMMET_INIT_FLAG] = true;
};

export interface EditorRuntimeMeta {
  totalLines: number;
  lineEnding: "LF" | "CRLF";
  language: string;
}

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  filename: string;
  filePath?: string;
  readOnly?: boolean;
  settings?: EditorSettings;
  initialCursorState?: CursorState;
  onCursorStateChange?: (state: CursorState) => void;
  onMetaChange?: (meta: EditorRuntimeMeta) => void;
  onBlur?: () => void;
  activeFileId?: Id<"files">;
  projectFiles?: Doc<"files">[];
  inlineSuggestionsEnabled?: boolean;
}

const clampOffset = (offset: number, max: number) =>
  Math.max(0, Math.min(offset, max));

const getLineEnding = (eol: string): "LF" | "CRLF" =>
  eol === "\r\n" ? "CRLF" : "LF";

const isAbortError = (error: unknown) =>
  (error instanceof DOMException && error.name === "AbortError") ||
  (error instanceof Error &&
    (error.name === "AbortError" || error.message === "Request aborted"));

type InlineSuggestionFetchResult = {
  outcome: "success" | "aborted" | "error";
  suggestion: string;
  message?: string;
  retryAfterSeconds?: number;
};

const getInlineSuggestionCooldownMs = (retryAfterSeconds?: number | null) => {
  if (typeof retryAfterSeconds === "number" && retryAfterSeconds > 0) {
    return Math.ceil(retryAfterSeconds * 1_000);
  }

  return INLINE_SUGGESTION_PROVIDER_COOLDOWN_FALLBACK_MS;
};

const isInlineSuggestionRateLimited = (message?: string) =>
  typeof message === "string" &&
  INLINE_SUGGESTION_PROVIDER_RATE_LIMIT_PATTERN.test(message);

const hasAsyncSuggestionHandle = (
  payload: SuggestionApiResponse | null,
): payload is SuggestionApiResponse & {
  requestId: string;
  token: string;
  streamUrl: string;
  pollUrl: string;
} =>
  Boolean(
    payload &&
    typeof payload.requestId === "string" &&
    payload.requestId.length > 0 &&
    typeof payload.token === "string" &&
    payload.token.length > 0 &&
    typeof payload.streamUrl === "string" &&
    payload.streamUrl.length > 0 &&
    typeof payload.pollUrl === "string" &&
    payload.pollUrl.length > 0,
  );

const areSelectionsEqual = (
  left: CursorState["selections"],
  right: CursorState["selections"],
) => {
  if (left.length !== right.length) {
    return false;
  }

  return left.every(
    (range, index) =>
      range.anchor === right[index]?.anchor &&
      range.head === right[index]?.head,
  );
};

const isCursorStateEqual = (left: CursorState, right: CursorState) =>
  left.line === right.line &&
  left.col === right.col &&
  left.selectionCount === right.selectionCount &&
  areSelectionsEqual(left.selections, right.selections);

const isRuntimeMetaEqual = (
  left: EditorRuntimeMeta,
  right: EditorRuntimeMeta,
) =>
  left.totalLines === right.totalLines &&
  left.lineEnding === right.lineEnding &&
  left.language === right.language;

export const CodeEditor = ({
  value,
  onChange,
  filename,
  filePath,
  readOnly = false,
  settings = DEFAULT_SETTINGS,
  initialCursorState,
  onCursorStateChange,
  onMetaChange,
  onBlur,
  activeFileId,
  projectFiles = [],
  inlineSuggestionsEnabled = false,
}: CodeEditorProps) => {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const disposablesRef = useRef<Monaco.IDisposable[]>([]);
  const lastCursorStateRef = useRef<CursorState | null>(null);
  const lastMetaRef = useRef<EditorRuntimeMeta | null>(null);
  const inlineSuggestionCacheRef = useRef<Map<string, string>>(new Map());
  const inlineSuggestionsEnabledRef = useRef(inlineSuggestionsEnabled);
  const inlineSuggestionCooldownUntilRef = useRef(0);
  const lastInlineSuggestionErrorAtRef = useRef(0);
  const lastInlineSuggestionRequestAtRef = useRef(0);
  const inlineSuggestionInFlightRef = useRef(false);
  const inlineSuggestAbortRef = useRef<AbortController | null>(null);

  const [selectionBar, setSelectionBar] = useState<{
    top: number;
    left: number;
    charCount: number;
  } | null>(null);
  const [aiInstruction, setAiInstruction] = useState("");
  const [isApplyingAi, setIsApplyingAi] = useState(false);
  const currentFileReference = filePath ?? filename;

  useEffect(() => {
    inlineSuggestionsEnabledRef.current = inlineSuggestionsEnabled;
  }, [inlineSuggestionsEnabled]);

  const buildRequestProjectContext = useCallback(
    (currentCode: string): SuggestionProjectContext | undefined => {
      if (!activeFileId || projectFiles.length === 0) {
        return undefined;
      }

      return buildSuggestionProjectContext({
        activeFileId,
        currentCode,
        projectFiles,
      });
    },
    [activeFileId, projectFiles],
  );

  useEffect(() => {
    inlineSuggestionCacheRef.current.clear();
    setSelectionBar(null);
    setAiInstruction("");
  }, [activeFileId, currentFileReference]);

  const cacheInlineSuggestion = useCallback(
    (key: string, suggestion: string) => {
      const cache = inlineSuggestionCacheRef.current;

      if (cache.has(key)) {
        cache.delete(key);
      }

      cache.set(key, suggestion);

      while (cache.size > INLINE_SUGGESTION_CACHE_LIMIT) {
        const oldestKey = cache.keys().next().value as string | undefined;
        if (!oldestKey) {
          break;
        }

        cache.delete(oldestKey);
      }
    },
    [],
  );

  const buildAutocompleteRequest = useCallback(
    (
      model: Monaco.editor.ITextModel,
      position: Monaco.Position,
    ): SuggestionRequestBody | null => {
      const editor = editorRef.current;
      if (!editor || readOnly) {
        return null;
      }

      const selections = editor.getSelections();
      if (!selections || selections.length !== 1 || !selections[0].isEmpty()) {
        return null;
      }

      const code = model.getValue();
      if (!code.trim()) {
        return null;
      }

      const lineNumber = position.lineNumber;
      const cursorOffset = model.getOffsetAt(position);
      const startLineNumber = Math.max(
        1,
        lineNumber - INLINE_SUGGESTION_LINE_WINDOW,
      );
      const endLineNumber = Math.min(
        model.getLineCount(),
        lineNumber + INLINE_SUGGESTION_LINE_WINDOW,
      );

      const previousLines =
        startLineNumber < lineNumber
          ? model.getValueInRange({
              startLineNumber,
              startColumn: 1,
              endLineNumber: lineNumber,
              endColumn: 1,
            })
          : "";
      const nextLines =
        lineNumber < endLineNumber
          ? model.getValueInRange({
              startLineNumber: lineNumber + 1,
              startColumn: 1,
              endLineNumber,
              endColumn: model.getLineMaxColumn(endLineNumber),
            })
          : "";

      return {
        mode: "autocomplete",
        fileName: currentFileReference,
        language: getLanguageName(currentFileReference),
        code,
        lineNumber,
        currentLine: model.getLineContent(lineNumber),
        previousLines,
        nextLines,
        textBeforeCursor: code.slice(0, cursorOffset),
        textAfterCursor: code.slice(cursorOffset),
        cursorOffset,
      };
    },
    [currentFileReference, readOnly],
  );

  const updateSelectionBarLayout = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || readOnly) {
      setSelectionBar(null);
      return;
    }

    // Guard: ensure the editor DOM node is still attached to the document.
    // If the editor was unmounted (e.g. file tab switch) but a scheduled
    // requestAnimationFrame or Monaco internal render cycle fires after
    // unmount, getDomNode() may still return the detached element while
    // getBoundingClientRect() returns all-zero values or throws because
    // Monaco's internal layout state is already torn down.
    const dom = editor.getDomNode();
    if (!dom || !dom.isConnected) {
      setSelectionBar(null);
      return;
    }

    const model = editor.getModel();
    const sel = editor.getSelection();
    if (!model || !sel || sel.isEmpty()) {
      setSelectionBar(null);
      return;
    }

    const endPos = sel.getEndPosition();
    const coords = editor.getScrolledVisiblePosition(endPos);
    if (!coords) {
      setSelectionBar(null);
      return;
    }

    const editorRect = dom.getBoundingClientRect();
    const text = model.getValueInRange(sel);

    const top = editorRect.top + coords.top + coords.height + 6;
    const left = editorRect.left + coords.left;

    setSelectionBar({
      top,
      left,
      charCount: text.length,
    });
  }, [readOnly]);

  useEffect(() => {
    if (readOnly || !selectionBar) {
      return;
    }

    const onResize = () => {
      updateSelectionBarLayout();
    };

    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [readOnly, selectionBar, updateSelectionBarLayout]);

  useEffect(() => {
    return () => {
      inlineSuggestAbortRef.current?.abort();
      inlineSuggestAbortRef.current = null;
      inlineSuggestionInFlightRef.current = false;

      disposablesRef.current.forEach((disposable) => disposable.dispose());
      disposablesRef.current = [];

      // Clear editor refs on unmount so any lingering Monaco RAF callbacks
      // that fire after unmount find null and bail out gracefully.
      editorRef.current = null;
      monacoRef.current = null;

      setSelectionBar(null);
    };
  }, []);

  const showInlineSuggestionError = useCallback((message?: string) => {
    const nextMessage = message?.trim();
    if (!nextMessage) {
      return;
    }

    const now = Date.now();
    if (
      now - lastInlineSuggestionErrorAtRef.current <
      INLINE_SUGGESTION_ERROR_TOAST_COOLDOWN_MS
    ) {
      return;
    }

    lastInlineSuggestionErrorAtRef.current = now;
    toast.error(nextMessage);
  }, []);

  const isInlineSuggestionCoolingDown = useCallback(
    () => inlineSuggestionCooldownUntilRef.current > Date.now(),
    [],
  );

  const pauseInlineSuggestions = useCallback((retryAfterSeconds?: number) => {
    inlineSuggestionCooldownUntilRef.current = Math.max(
      inlineSuggestionCooldownUntilRef.current,
      Date.now() + getInlineSuggestionCooldownMs(retryAfterSeconds),
    );
  }, []);

  const areInlineSuggestionsEnabled = useCallback(
    () => inlineSuggestionsEnabledRef.current,
    [],
  );

  const emitState = useCallback(
    (docChanged = false) => {
      const editor = editorRef.current;
      if (!editor) {
        return;
      }

      const model = editor.getModel();
      if (!model) {
        return;
      }

      const cursor = editor.getPosition() ?? { lineNumber: 1, column: 1 };
      const rawSelections = editor.getSelections() ?? [];
      const selections =
        rawSelections.length > 0
          ? rawSelections.map((selection) => ({
              anchor: model.getOffsetAt({
                lineNumber: selection.selectionStartLineNumber,
                column: selection.selectionStartColumn,
              }),
              head: model.getOffsetAt({
                lineNumber: selection.positionLineNumber,
                column: selection.positionColumn,
              }),
            }))
          : [
              {
                anchor: model.getOffsetAt(cursor),
                head: model.getOffsetAt(cursor),
              },
            ];

      const nextCursorState: CursorState = {
        line: cursor.lineNumber,
        col: cursor.column,
        selectionCount: selections.length,
        selections,
      };

      if (
        !lastCursorStateRef.current ||
        !isCursorStateEqual(lastCursorStateRef.current, nextCursorState)
      ) {
        lastCursorStateRef.current = nextCursorState;
        onCursorStateChange?.(nextCursorState);
      }

      if (!onMetaChange) {
        return;
      }

      const previousMeta = lastMetaRef.current;
      const nextMeta: EditorRuntimeMeta = {
        totalLines: model.getLineCount(),
        lineEnding:
          docChanged || !previousMeta
            ? getLineEnding(model.getEOL())
            : previousMeta.lineEnding,
        language: getLanguageName(currentFileReference),
      };

      if (!previousMeta || !isRuntimeMetaEqual(previousMeta, nextMeta)) {
        lastMetaRef.current = nextMeta;
        onMetaChange(nextMeta);
      }
    },
    [currentFileReference, onCursorStateChange, onMetaChange],
  );

  const formatInsertedRange = useCallback(
    async (startPosition: Monaco.Position, endPosition: Monaco.Position) => {
      const editor = editorRef.current;
      const monacoApi = monacoRef.current;
      const model = editor?.getModel();
      if (!editor || !monacoApi || !model || readOnly) {
        return;
      }

      const startOffset = model.getOffsetAt(startPosition);
      const endOffset = model.getOffsetAt(endPosition);
      if (endOffset <= startOffset) {
        return;
      }

      const start = model.getPositionAt(startOffset);
      const end = model.getPositionAt(endOffset);

      editor.setSelection(
        new monacoApi.Selection(
          start.lineNumber,
          start.column,
          end.lineNumber,
          end.column,
        ),
      );

      const formatSelectionAction = editor.getAction(
        "editor.action.formatSelection",
      );
      if (formatSelectionAction) {
        await formatSelectionAction.run();
      } else {
        const formatDocumentAction = editor.getAction(
          "editor.action.formatDocument",
        );
        if (formatDocumentAction) {
          await formatDocumentAction.run();
        }
      }

      editor.setSelection(
        new monacoApi.Selection(
          end.lineNumber,
          end.column,
          end.lineNumber,
          end.column,
        ),
      );
      editor.setPosition(end);
    },
    [readOnly],
  );

  const waitForPollTick = useCallback(
    (ms: number, signal?: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error("Request aborted"));
          return;
        }

        let timeout: ReturnType<typeof setTimeout> | null = null;

        const cleanup = () => {
          if (timeout) {
            clearTimeout(timeout);
          }
          signal?.removeEventListener("abort", onAbort);
        };

        const onAbort = () => {
          cleanup();
          reject(new Error("Request aborted"));
        };

        timeout = setTimeout(() => {
          cleanup();
          resolve();
        }, ms);

        signal?.addEventListener("abort", onAbort, { once: true });
      }),
    [],
  );

  const pollBackgroundSuggestion = useCallback(
    async (pollUrl: string, signal?: AbortSignal) => {
      const deadline = Date.now() + ASYNC_SUGGESTION_TIMEOUT_MS;

      while (Date.now() < deadline) {
        const response = await fetch(pollUrl, {
          method: "GET",
          signal,
        });

        const payload = (await response
          .json()
          .catch(() => null)) as SuggestionApiResponse | null;

        if (response.ok) {
          const text = payload?.suggestion ?? payload?.sugegstions ?? "";
          if (
            payload?.error &&
            typeof payload.error === "string" &&
            payload.error.trim() &&
            !text.trim()
          ) {
            const detail = payload.detail?.trim();
            throw new Error(`${payload.error}${detail ? ` - ${detail}` : ""}`);
          }
          return payload;
        }

        if ([202, 429].includes(response.status)) {
          await waitForPollTick(ASYNC_SUGGESTION_POLL_INTERVAL_MS, signal);
          continue;
        }

        const detail = payload?.detail?.trim();
        throw new Error(
          `${payload?.error ?? "Failed to poll background suggestion."}${detail ? ` ${detail}` : ""}`,
        );
      }

      throw new Error("Timed out waiting for background suggestion result.");
    },
    [waitForPollTick],
  );

  const streamBackgroundSuggestion = useCallback(
    async (
      handle: Extract<
        SuggestionApiResponse,
        {
          requestId?: string;
          token?: string;
          streamUrl?: string;
          pollUrl?: string;
        }
      >,
      signal?: AbortSignal,
    ) => {
      if (typeof EventSource === "undefined") {
        return pollBackgroundSuggestion(handle.pollUrl!, signal);
      }

      return await new Promise<SuggestionApiResponse>((resolve, reject) => {
        let settled = false;
        const eventSource = new EventSource(handle.streamUrl!);

        const cleanup = () => {
          if (settled) {
            return;
          }

          settled = true;
          eventSource.close();
          signal?.removeEventListener("abort", onAbort);
        };

        const finishWithResolve = (payload: SuggestionApiResponse) => {
          cleanup();
          resolve(payload);
        };

        const finishWithReject = (error: Error) => {
          cleanup();
          reject(error);
        };

        const onAbort = () => {
          finishWithReject(new Error("Request aborted"));
        };

        signal?.addEventListener("abort", onAbort, { once: true });

        eventSource.addEventListener("complete", (event) => {
          const payload = JSON.parse(
            (event as MessageEvent<string>).data,
          ) as SuggestionApiResponse;
          finishWithResolve(payload);
        });

        eventSource.addEventListener("failure", (event) => {
          const payload = JSON.parse(
            (event as MessageEvent<string>).data,
          ) as SuggestionApiResponse;
          const detail = payload.detail?.trim();
          finishWithReject(
            new Error(
              `${payload.error ?? "Failed to stream background suggestion."}${detail ? ` - ${detail}` : ""}`,
            ),
          );
        });

        eventSource.onerror = () => {
          eventSource.close();
          signal?.removeEventListener("abort", onAbort);
          void pollBackgroundSuggestion(handle.pollUrl!, signal)
            .then((nextPayload) => {
              if (!nextPayload) {
                reject(new Error("Failed to poll background suggestion."));
                return;
              }

              resolve(nextPayload);
            })
            .catch(reject);
        };
      });
    },
    [pollBackgroundSuggestion],
  );

  const requestAutocompleteSuggestion = useCallback(
    async (requestBody: SuggestionRequestBody, signal?: AbortSignal) => {
      try {
        const response = await fetch("/api/suggestion", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
          signal,
        });

        let payload = (await response
          .json()
          .catch(() => null)) as SuggestionApiResponse | null;

        if (response.ok && payload && hasAsyncSuggestionHandle(payload)) {
          payload = await streamBackgroundSuggestion(payload, signal);
        }

        if (!response.ok) {
          const detail = payload?.detail?.trim();
          const retryAfterSeconds = payload?.retryAfterSeconds;
          const retryHint =
            typeof retryAfterSeconds === "number" && retryAfterSeconds > 0
              ? ` Retry in ${Math.ceil(retryAfterSeconds)}s.`
              : "";

          return {
            outcome: "error",
            suggestion: "",
            retryAfterSeconds,
            message:
              payload?.error ?? "Inline suggestions are unavailable right now.",
          } satisfies InlineSuggestionFetchResult;
        }

        if (
          payload &&
          typeof payload.error === "string" &&
          payload.error.trim() &&
          !(payload.suggestion ?? payload.sugegstions ?? "").trim()
        ) {
          const detail = payload.detail?.trim();

          return {
            outcome: "error",
            suggestion: "",
            retryAfterSeconds: payload.retryAfterSeconds,
            message: payload.error,
          } satisfies InlineSuggestionFetchResult;
        }

        return {
          outcome: "success",
          suggestion: payload?.suggestion ?? payload?.sugegstions ?? "",
        } satisfies InlineSuggestionFetchResult;
      } catch (error) {
        if (isAbortError(error)) {
          return {
            outcome: "aborted",
            suggestion: "",
          } satisfies InlineSuggestionFetchResult;
        }

        return {
          outcome: "error",
          suggestion: "",
          message: getFriendlyErrorMessage(
            error,
            "Inline suggestions are unavailable right now.",
          ),
        } satisfies InlineSuggestionFetchResult;
      }
    },
    [streamBackgroundSuggestion],
  );

  useEffect(() => {
    if (inlineSuggestionsEnabled) {
      inlineSuggestionCooldownUntilRef.current = 0;
      lastInlineSuggestionRequestAtRef.current = 0;
      return;
    }

    inlineSuggestionCooldownUntilRef.current = 0;
    lastInlineSuggestionRequestAtRef.current = 0;
    inlineSuggestionCacheRef.current.clear();
    inlineSuggestionInFlightRef.current = false;
    inlineSuggestAbortRef.current?.abort();
    inlineSuggestAbortRef.current = null;

    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const hideAction = editor.getAction("editor.action.inlineSuggest.hide");
    if (hideAction) {
      void hideAction.run();
      return;
    }

    editor.trigger(
      "orbit-inline-suggest",
      "editor.action.inlineSuggest.hide",
      {},
    );
  }, [inlineSuggestionsEnabled]);

  const handleApplyAiTransform = useCallback(async () => {
    if (isApplyingAi || readOnly) {
      return;
    }

    const editor = editorRef.current;
    const model = editor?.getModel();
    const sel = editor?.getSelection();
    if (!editor || !model || !sel || sel.isEmpty()) {
      toast.error("Select a piece of code first.");
      return;
    }

    const instruction = aiInstruction.trim();
    if (!instruction) {
      toast.error("Describe what you want changed.");
      return;
    }

    const selectedText = model.getValueInRange(sel);
    const startOffset = model.getOffsetAt(sel.getStartPosition());
    const endOffset = model.getOffsetAt(sel.getEndPosition());
    const fullCode = model.getValue();
    const lineNumber = sel.endLineNumber;

    setIsApplyingAi(true);

    try {
      const response = await fetch("/api/suggestion", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: "transform",
          fileName: currentFileReference,
          language: getLanguageName(currentFileReference),
          code: fullCode,
          instruction,
          selectedCode: selectedText,
          selectionStartOffset: startOffset,
          selectionEndOffset: endOffset,
          lineNumber,
          textBeforeCursor: fullCode.slice(0, startOffset),
          textAfterCursor: fullCode.slice(endOffset),
          cursorOffset: startOffset,
          projectContext: buildRequestProjectContext(fullCode),
        }),
      });

      let payload = (await response
        .json()
        .catch(() => null)) as SuggestionApiResponse | null;

      if (response.ok && payload && hasAsyncSuggestionHandle(payload)) {
        payload = await streamBackgroundSuggestion(payload);
      }

      if (!response.ok) {
        throw new Error(
          payload?.error ?? "Unable to process your code. Please try again.",
        );
      }

      if (
        payload &&
        typeof payload.error === "string" &&
        payload.error.trim() &&
        !(payload.suggestion ?? payload.sugegstions ?? "").trim()
      ) {
        throw new Error(payload.error);
      }

      const nextCode = payload?.suggestion ?? payload?.sugegstions ?? "";
      if (!nextCode) {
        toast.error(
          "AI did not return a result. Please try again with different instructions.",
        );
        return;
      }

      const monacoApi = monacoRef.current;
      const latestModel = editor.getModel();
      if (!latestModel || !monacoApi || latestModel.getValue() !== fullCode) {
        toast.error("File changed before the response arrived. Try again.");
        return;
      }

      const documentRange = new monacoApi.Range(
        1,
        1,
        latestModel.getLineCount(),
        latestModel.getLineMaxColumn(latestModel.getLineCount()),
      );

      editor.executeEdits("orbit-ai-transform", [
        {
          range: documentRange,
          text: nextCode,
          forceMoveMarkers: true,
        },
      ]);

      const transformedModel = editor.getModel();
      if (transformedModel) {
        const documentStart = transformedModel.getPositionAt(0);
        const documentEnd = transformedModel.getPositionAt(nextCode.length);

        await formatInsertedRange(documentStart, documentEnd);
      }

      setAiInstruction("");
      emitState(true);
      toast.success("Applied AI update to the file.");
      requestAnimationFrame(() => {
        updateSelectionBarLayout();
      });
    } catch (error) {
      toast.error(
        getFriendlyErrorMessage(
          error,
          "Unable to apply AI changes. Please try again.",
        ),
      );
    } finally {
      setIsApplyingAi(false);
    }
  }, [
    aiInstruction,
    buildRequestProjectContext,
    emitState,
    formatInsertedRange,
    isApplyingAi,
    readOnly,
    currentFileReference,
    streamBackgroundSuggestion,
    updateSelectionBarLayout,
  ]);

  const runEditorAction = useCallback((actionId: string) => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const action = editor.getAction(actionId);
    if (action) {
      void action.run();
    }
  }, []);

  const insertTextAtSelections = useCallback(
    (text: string) => {
      const editor = editorRef.current;
      if (!editor || readOnly) {
        return;
      }

      const selections = editor.getSelections();
      if (!selections || selections.length === 0) {
        return;
      }

      editor.executeEdits(
        "orbit-paste",
        selections.map((selection) => ({
          range: selection,
          text,
          forceMoveMarkers: true,
        })),
      );

      emitState(true);
    },
    [emitState, readOnly],
  );

  const executeClipboardAction = useCallback(
    async (action: "copy" | "cut" | "paste") => {
      if (action === "copy") {
        runEditorAction("editor.action.clipboardCopyAction");
        return;
      }

      if (action === "cut") {
        if (readOnly) {
          return;
        }

        runEditorAction("editor.action.clipboardCutAction");
        return;
      }

      if (readOnly) {
        return;
      }

      try {
        const text = await navigator.clipboard.readText();
        if (text.length > 0) {
          insertTextAtSelections(text);
          return;
        }
      } catch {}

      runEditorAction("editor.action.clipboardPasteAction");
    },
    [insertTextAtSelections, readOnly, runEditorAction],
  );

  const restoreInitialState = useCallback(
    (editor: Monaco.editor.IStandaloneCodeEditor, monacoApi: typeof Monaco) => {
      const model = editor.getModel();
      if (!model) {
        emitState();
        return;
      }

      if (!initialCursorState) {
        emitState();
        return;
      }

      const maxOffset = model.getValueLength();

      const selections =
        initialCursorState.selections.length > 0
          ? initialCursorState.selections.map((range) => {
              const anchor = model.getPositionAt(
                clampOffset(range.anchor, maxOffset),
              );
              const head = model.getPositionAt(
                clampOffset(range.head, maxOffset),
              );

              return new monacoApi.Selection(
                anchor.lineNumber,
                anchor.column,
                head.lineNumber,
                head.column,
              );
            })
          : (() => {
              const line = Math.max(
                1,
                Math.min(initialCursorState.line, model.getLineCount()),
              );
              const col = Math.max(
                1,
                Math.min(initialCursorState.col, model.getLineMaxColumn(line)),
              );

              return [new monacoApi.Selection(line, col, line, col)];
            })();

      editor.setSelections(selections);

      const position = editor.getPosition();
      if (position) {
        editor.revealPositionInCenter(
          position,
          monacoApi.editor.ScrollType.Immediate,
        );
      }

      emitState();
    },
    [emitState, initialCursorState],
  );

  const handleBeforeMount = useCallback<BeforeMount>((monacoApi) => {
    initializeEmmet(monacoApi);

    const compilerOptions = {
      target: monacoApi.languages.typescript.ScriptTarget.ESNext,
      module: monacoApi.languages.typescript.ModuleKind.ESNext,
      moduleResolution:
        monacoApi.languages.typescript.ModuleResolutionKind.NodeJs,
      jsx: monacoApi.languages.typescript.JsxEmit.ReactJSX,
      allowNonTsExtensions: true,
      allowJs: true,
      checkJs: false,
      strict: false,
      noEmit: true,
      skipLibCheck: true,
      resolveJsonModule: true,
      isolatedModules: true,
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
      lib: ["esnext", "dom", "dom.iterable"],
    };

    const diagnosticsOptions = {
      noSemanticValidation: true,
      noSyntaxValidation: false,
      noSuggestionDiagnostics: true,
    };

    monacoApi.languages.typescript.typescriptDefaults.setEagerModelSync(true);
    monacoApi.languages.typescript.javascriptDefaults.setEagerModelSync(true);

    monacoApi.languages.typescript.typescriptDefaults.setCompilerOptions(
      compilerOptions,
    );
    monacoApi.languages.typescript.javascriptDefaults.setCompilerOptions(
      compilerOptions,
    );

    monacoApi.languages.typescript.typescriptDefaults.setDiagnosticsOptions(
      diagnosticsOptions,
    );
    monacoApi.languages.typescript.javascriptDefaults.setDiagnosticsOptions(
      diagnosticsOptions,
    );
  }, []);

  const language = useMemo(
    () => getMonacoLanguage(currentFileReference),
    [currentFileReference],
  );

  const handleMount = useCallback<OnMount>(
    (editor, monacoApi) => {
      editorRef.current = editor;
      monacoRef.current = monacoApi;

      disposablesRef.current.forEach((disposable) => disposable.dispose());
      disposablesRef.current = [
        monacoApi.languages.registerInlineCompletionsProvider(language, {
          debounceDelayMs: 800,
          displayName: "Orbit AI",
          provideInlineCompletions: async (
            model: Monaco.editor.ITextModel,
            position: Monaco.Position,
            context: Monaco.languages.InlineCompletionContext,
            token: Monaco.CancellationToken,
          ) => {
            if (readOnly || !areInlineSuggestionsEnabled()) {
              return { items: [] };
            }

            if (isInlineSuggestionCoolingDown()) {
              return { items: [] };
            }

            const activeEditor = editorRef.current;
            if (
              !activeEditor ||
              activeEditor.getModel()?.uri.toString() !== model.uri.toString()
            ) {
              return { items: [] };
            }

            const selection = activeEditor.getSelection();
            if (!selection || !selection.isEmpty()) {
              return { items: [] };
            }

            const lineContent = model.getLineContent(position.lineNumber);
            const linePrefix = lineContent.slice(
              0,
              Math.max(0, position.column - 1),
            );
            const lineSuffix = lineContent.slice(position.column - 1);

            // Skip if line is empty or whitespace-only
            if (!linePrefix.trim()) {
              return { items: [] };
            }

            // Skip automatic triggers if prefix is too short
            if (
              context.triggerKind ===
                monacoApi.languages.InlineCompletionTriggerKind.Automatic &&
              linePrefix.trim().length <
                INLINE_SUGGESTION_MIN_AUTOMATIC_PREFIX_CHARS
            ) {
              return { items: [] };
            }

            // Skip if cursor is right after only opening brackets/braces (too early)
            if (/^[\s]*[{(\[]\s*$/.test(linePrefix)) {
              return { items: [] };
            }

            // Skip comment-only lines (user is writing comments, not code)
            if (
              /^\s*\/\/\s*$/.test(linePrefix) ||
              /^\s*#\s*$/.test(linePrefix)
            ) {
              return { items: [] };
            }

            // Skip if there's significant text after cursor (user is editing mid-line)
            if (lineSuffix.trim().length > 15) {
              return { items: [] };
            }

            const cacheKey = `${model.uri.toString()}:${model.getVersionId()}:${model.getOffsetAt(position)}`;
            const cachedSuggestion =
              inlineSuggestionCacheRef.current.get(cacheKey);
            if (typeof cachedSuggestion === "string") {
              if (!cachedSuggestion) {
                return { items: [] };
              }

              return {
                items: [
                  {
                    insertText: cachedSuggestion,
                    range: new monacoApi.Range(
                      position.lineNumber,
                      position.column,
                      position.lineNumber,
                      position.column,
                    ),
                  },
                ],
              };
            }

            const requestBody = buildAutocompleteRequest(model, position);
            if (!requestBody) {
              return { items: [] };
            }

            if (inlineSuggestionInFlightRef.current) {
              return { items: [] };
            }

            const now = Date.now();
            const isAutomaticTrigger =
              context.triggerKind ===
              monacoApi.languages.InlineCompletionTriggerKind.Automatic;

            if (
              isAutomaticTrigger &&
              now - lastInlineSuggestionRequestAtRef.current <
                INLINE_SUGGESTION_MIN_REQUEST_INTERVAL_MS
            ) {
              return { items: [] };
            }

            lastInlineSuggestionRequestAtRef.current = now;
            inlineSuggestionInFlightRef.current = true;
            const controller = new AbortController();
            inlineSuggestAbortRef.current = controller;

            const cancelSubscription = token.onCancellationRequested(() => {
              controller.abort();
            });

            try {
              const result = await requestAutocompleteSuggestion(
                requestBody,
                controller.signal,
              );

              if (result.outcome === "success") {
                cacheInlineSuggestion(cacheKey, result.suggestion);
              } else if (result.outcome === "error") {
                if (
                  typeof result.retryAfterSeconds === "number" ||
                  isInlineSuggestionRateLimited(result.message)
                ) {
                  pauseInlineSuggestions(result.retryAfterSeconds);
                }

                showInlineSuggestionError(result.message);
              }

              if (
                token.isCancellationRequested ||
                result.outcome !== "success" ||
                !result.suggestion
              ) {
                return { items: [] };
              }

              const latestEditor = editorRef.current;
              if (
                !latestEditor ||
                latestEditor.getModel()?.uri.toString() !== model.uri.toString()
              ) {
                return { items: [] };
              }

              return {
                items: [
                  {
                    insertText: result.suggestion,
                    range: new monacoApi.Range(
                      position.lineNumber,
                      position.column,
                      position.lineNumber,
                      position.column,
                    ),
                  },
                ],
              };
            } finally {
              cancelSubscription.dispose();
              if (inlineSuggestAbortRef.current === controller) {
                inlineSuggestAbortRef.current = null;
              }
              inlineSuggestionInFlightRef.current = false;
            }
          },
          disposeInlineCompletions: () => {},
        }),
        editor.onDidChangeCursorSelection(() => {
          emitState(false);
          updateSelectionBarLayout();
        }),
        editor.onDidChangeModelContent(() => {
          emitState(true);
          updateSelectionBarLayout();
        }),
        editor.onDidChangeModel(() => {
          emitState(true);
          updateSelectionBarLayout();
        }),
        editor.onDidScrollChange(() => {
          updateSelectionBarLayout();
        }),
        editor.onDidLayoutChange(() => {
          updateSelectionBarLayout();
        }),
        editor.onDidFocusEditorText(() => {
          updateSelectionBarLayout();
        }),
        editor.onDidBlurEditorText(() => {
          onBlur?.();
        }),
        editor.onMouseDown((event) => {
          if (
            event.target.type !==
            monacoApi.editor.MouseTargetType.GUTTER_LINE_NUMBERS
          ) {
            return;
          }

          const lineNumber = event.target.position?.lineNumber;
          if (!lineNumber) {
            return;
          }

          editor.setPosition({ lineNumber, column: 1 });
          editor.revealLineInCenterIfOutsideViewport(lineNumber);
          editor.focus();
          emitState(false);
        }),
      ];

      restoreInitialState(editor, monacoApi);
      updateSelectionBarLayout();
    },
    [
      buildAutocompleteRequest,
      cacheInlineSuggestion,
      emitState,
      areInlineSuggestionsEnabled,
      isInlineSuggestionCoolingDown,
      language,
      onBlur,
      pauseInlineSuggestions,
      readOnly,
      requestAutocompleteSuggestion,
      restoreInitialState,
      showInlineSuggestionError,
      updateSelectionBarLayout,
    ],
  );

  const options = useMemo<Monaco.editor.IStandaloneEditorConstructionOptions>(
    () => ({
      automaticLayout: true,
      readOnly,
      wordWrap: settings.wordWrap ? "on" : "off",
      lineNumbers: settings.lineNumbers,
      renderWhitespace: settings.renderWhitespace,
      fontSize: settings.fontSize,
      lineHeight: Math.max(18, Math.round(settings.fontSize * 1.6)),
      fontFamily:
        "var(--font-plex-mono), 'IBM Plex Mono', Consolas, 'Courier New', monospace",
      fontLigatures: false,
      tabSize: settings.tabSize,
      insertSpaces: settings.insertSpaces,
      minimap: {
        enabled: settings.minimap,
        showSlider: "always",
        renderCharacters: true,
        autohide: "none",
        side: "right",
        maxColumn: 140,
        size: "proportional",
        scale: 1,
      },
      scrollbar: {
        alwaysConsumeMouseWheel: false,
        useShadows: false,
        verticalScrollbarSize: 12,
        horizontalScrollbarSize: 12,
      },
      smoothScrolling: false,
      scrollBeyondLastLine: true,
      scrollBeyondLastColumn: 4,
      cursorBlinking: "solid",
      cursorSmoothCaretAnimation: "off",
      cursorSurroundingLines: 2,
      padding: {
        top: 14,
        bottom: 14,
      },
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      folding: true,
      contextmenu: false,
      dragAndDrop: true,
      mouseWheelZoom: true,
      multiCursorModifier: "alt",
      autoClosingBrackets: "languageDefined",
      autoClosingQuotes: "languageDefined",
      autoClosingDelete: "auto",
      autoClosingOvertype: "auto",
      autoSurround: "languageDefined",
      tabCompletion: "on",
      quickSuggestions: {
        other: true,
        comments: true,
        strings: true,
      },
      quickSuggestionsDelay: 150,
      suggestOnTriggerCharacters: true,
      suggestSelection: "first",
      acceptSuggestionOnEnter: "smart",
      inlineSuggest: {
        enabled: !readOnly && inlineSuggestionsEnabled,
        mode: "prefix",
        minShowDelay: 150,
        showToolbar: "onHover",
        suppressSuggestions: false,
        syntaxHighlightingEnabled: true,
      },
      snippetSuggestions: "inline",
      wordBasedSuggestions: "currentDocument",
      inlayHints: {
        enabled: "on",
      },
      guides: {
        indentation: true,
        highlightActiveIndentation: true,
        bracketPairs: true,
        bracketPairsHorizontal: true,
      },
      bracketPairColorization: {
        enabled: true,
        independentColorPoolPerBracketType: true,
      },
      stickyScroll: {
        enabled: true,
      },
      matchBrackets: "always",
      renderLineHighlight: "all",
      renderLineHighlightOnlyWhenFocus: false,
      selectionHighlight: true,
      occurrencesHighlight: "singleFile",
      formatOnPaste: true,
      formatOnType: true,
      glyphMargin: true,
      links: true,
    }),
    [inlineSuggestionsEnabled, readOnly, settings],
  );

  const handleChange = useCallback(
    (nextValue: string | undefined) => {
      onChange(nextValue ?? "");
    },
    [onChange],
  );

  const handleAiInstructionKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter" || isApplyingAi) {
        return;
      }
      event.preventDefault();
      void handleApplyAiTransform();
    },
    [handleApplyAiTransform, isApplyingAi],
  );

  return (
    <EditorContextMenu
      onCut={() => {
        void executeClipboardAction("cut");
      }}
      onCopy={() => {
        void executeClipboardAction("copy");
      }}
      onPaste={() => {
        void executeClipboardAction("paste");
      }}
      onCommandPalette={() => runEditorAction("editor.action.quickCommand")}
      onGoToSymbol={() => runEditorAction("editor.action.quickOutline")}
      onGoToDefinition={() => runEditorAction("editor.action.revealDefinition")}
      onPeekDefinition={() => runEditorAction("editor.action.peekDefinition")}
      onRenameSymbol={() => runEditorAction("editor.action.rename")}
      onQuickFix={() => runEditorAction("editor.action.quickFix")}
      onSelectAll={() => runEditorAction("editor.action.selectAll")}
      onFind={() => runEditorAction("actions.find")}
      onReplace={() => runEditorAction("editor.action.startFindReplaceAction")}
      onGoToLine={() => runEditorAction("editor.action.gotoLine")}
      onToggleLineComment={() => runEditorAction("editor.action.commentLine")}
      onToggleBlockComment={() => runEditorAction("editor.action.blockComment")}
      onFold={() => runEditorAction("editor.fold")}
      onUnfold={() => runEditorAction("editor.unfold")}
      onFoldAll={() => runEditorAction("editor.foldAll")}
      onUnfoldAll={() => runEditorAction("editor.unfoldAll")}
      onFormatDocument={() => runEditorAction("editor.action.formatDocument")}
    >
      <div className="size-full overflow-hidden">
        <MonacoEditor
          key={currentFileReference}
          beforeMount={handleBeforeMount}
          height="100%"
          width="100%"
          value={value}
          language={language}
          path={currentFileReference}
          theme="vs-dark"
          options={options}
          onMount={handleMount}
          onChange={handleChange}
          loading={null}
        />
      </div>
      {!readOnly && selectionBar && (
        <EditorSelectionAiBar
          top={selectionBar.top}
          left={selectionBar.left}
          selectedCharCount={selectionBar.charCount}
          instruction={aiInstruction}
          onInstructionChange={setAiInstruction}
          onApply={handleApplyAiTransform}
          onKeyDown={handleAiInstructionKeyDown}
          isApplying={isApplyingAi}
        />
      )}
    </EditorContextMenu>
  );
};

// Monaco has a harmless race-condition rendering bug during React unmounts
// that throws "Cannot read properties of null (reading 'left')".
// This intercepts it so Next.js doesn't show a red screen of death.
if (typeof window !== "undefined") {
  window.addEventListener("error", (e) => {
    if (
      e.message.includes("reading 'left'") &&
      e.filename.includes("monaco-editor")
    ) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  });

  window.addEventListener("unhandledrejection", (e) => {
    if (
      e.reason?.message?.includes("reading 'left'") &&
      e.reason?.stack?.includes("monaco-editor")
    ) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  });
}
