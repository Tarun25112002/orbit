"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import MonacoEditor, {
  type BeforeMount,
  type OnMount,
} from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { emmetCSS, emmetHTML, emmetJSX } from "emmet-monaco-es";

import {
  type CursorState,
  type EditorSettings,
} from "../store/use-editor-store";
import {
  getLanguageName,
  getMonacoLanguage,
} from "../utils/language-detection";
import { EditorContextMenu } from "./editor-context-menu";

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
const INLINE_SUGGESTION_DEBOUNCE_MS = 320;
const INLINE_SUGGESTION_CONTEXT_LINES = 40;
const INLINE_SUGGESTION_MAX_BEFORE = 2_000;
const INLINE_SUGGESTION_MAX_AFTER = 1_200;

interface SuggestionApiResponse {
  suggestion?: string;
  sugegstions?: string;
  error?: string;
}

interface InlineSuggestionState {
  offset: number;
  lineNumber: number;
  column: number;
  modelVersionId: number;
  text: string;
}

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
  readOnly?: boolean;
  settings?: EditorSettings;
  initialCursorState?: CursorState;
  onCursorStateChange?: (state: CursorState) => void;
  onMetaChange?: (meta: EditorRuntimeMeta) => void;
  onBlur?: () => void;
}

const clampOffset = (offset: number, max: number) =>
  Math.max(0, Math.min(offset, max));

const getLineEnding = (eol: string): "LF" | "CRLF" =>
  eol === "\r\n" ? "CRLF" : "LF";

const sanitizeInlineSuggestion = (value: string) =>
  value
    .replace(/^```[a-zA-Z0-9_-]*\n?/, "")
    .replace(/\n?```$/, "")
    .replace(/\r\n/g, "\n");

const clampContextText = (value: string, max: number, fromEnd = false) => {
  if (value.length <= max) {
    return value;
  }

  return fromEnd ? value.slice(value.length - max) : value.slice(0, max);
};

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
  readOnly = false,
  settings = DEFAULT_SETTINGS,
  initialCursorState,
  onCursorStateChange,
  onMetaChange,
  onBlur,
}: CodeEditorProps) => {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const disposablesRef = useRef<Monaco.IDisposable[]>([]);
  const inlineProviderDisposableRef = useRef<Monaco.IDisposable | null>(null);
  const inlineRequestAbortRef = useRef<AbortController | null>(null);
  const inlineDebounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const inlineSuggestionRef = useRef<InlineSuggestionState | null>(null);
  const lastInlineRequestKeyRef = useRef("");
  const inlineRequestCounterRef = useRef(0);
  const lastCursorStateRef = useRef<CursorState | null>(null);
  const lastMetaRef = useRef<EditorRuntimeMeta | null>(null);

  useEffect(() => {
    return () => {
      disposablesRef.current.forEach((disposable) => disposable.dispose());
      disposablesRef.current = [];

      inlineProviderDisposableRef.current?.dispose();
      inlineProviderDisposableRef.current = null;

      if (inlineDebounceTimeoutRef.current) {
        clearTimeout(inlineDebounceTimeoutRef.current);
        inlineDebounceTimeoutRef.current = null;
      }

      inlineRequestAbortRef.current?.abort();
      inlineRequestAbortRef.current = null;
    };
  }, []);

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
        language: getLanguageName(filename),
      };

      if (!previousMeta || !isRuntimeMetaEqual(previousMeta, nextMeta)) {
        lastMetaRef.current = nextMeta;
        onMetaChange(nextMeta);
      }
    },
    [filename, onCursorStateChange, onMetaChange],
  );

  const triggerInlineSuggestionWidget = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const action = editor.getAction("editor.action.inlineSuggest.trigger");
    if (action) {
      void action.run();
    }
  }, []);

  const clearInlineSuggestion = useCallback(
    (resetRequestKey = false) => {
      inlineSuggestionRef.current = null;

      if (resetRequestKey) {
        lastInlineRequestKeyRef.current = "";
      }

      triggerInlineSuggestionWidget();
    },
    [triggerInlineSuggestionWidget],
  );

  const requestInlineSuggestion = useCallback(async () => {
    if (readOnly) {
      return;
    }

    const editor = editorRef.current;
    const monacoApi = monacoRef.current;
    if (!editor || !monacoApi || !editor.hasTextFocus()) {
      return;
    }

    const model = editor.getModel();
    const position = editor.getPosition();
    if (!model || !position) {
      return;
    }

    const selection = editor.getSelection();
    if (selection && !selection.isEmpty()) {
      clearInlineSuggestion();
      return;
    }

    const cursorOffset = model.getOffsetAt(position);
    const currentLine = model.getLineContent(position.lineNumber);
    const textBeforeCursor = clampContextText(
      currentLine.slice(0, position.column - 1),
      INLINE_SUGGESTION_MAX_BEFORE,
      true,
    );
    const textAfterCursor = clampContextText(
      currentLine.slice(position.column - 1),
      INLINE_SUGGESTION_MAX_AFTER,
    );

    if (textBeforeCursor.trim().length === 0 && textAfterCursor.trim().length === 0) {
      clearInlineSuggestion();
      return;
    }

    const modelVersionId = model.getVersionId();
    const requestKey = `${model.uri.toString()}:${modelVersionId}:${cursorOffset}`;
    if (lastInlineRequestKeyRef.current === requestKey) {
      return;
    }

    lastInlineRequestKeyRef.current = requestKey;
    inlineRequestCounterRef.current += 1;
    const requestId = inlineRequestCounterRef.current;

    const previousStartLine = Math.max(
      1,
      position.lineNumber - INLINE_SUGGESTION_CONTEXT_LINES,
    );
    const nextEndLine = Math.min(
      model.getLineCount(),
      position.lineNumber + INLINE_SUGGESTION_CONTEXT_LINES,
    );

    const previousLines =
      previousStartLine < position.lineNumber
        ? model.getValueInRange(
            new monacoApi.Range(previousStartLine, 1, position.lineNumber, 1),
          )
        : "";
    const nextLines =
      position.lineNumber < nextEndLine
        ? model.getValueInRange(
            new monacoApi.Range(
              position.lineNumber + 1,
              1,
              nextEndLine,
              model.getLineMaxColumn(nextEndLine),
            ),
          )
        : "";

    inlineRequestAbortRef.current?.abort();
    const abortController = new AbortController();
    inlineRequestAbortRef.current = abortController;

    try {
      const response = await fetch("/api/suggestion", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: abortController.signal,
        body: JSON.stringify({
          mode: "autocomplete",
          fileName: filename,
          code: model.getValue(),
          lineNumber: position.lineNumber,
          currentLine,
          previousLines,
          nextLines,
          textBeforeCursor,
          textAfterCursor,
          cursorOffset,
        }),
      });

      if (!response.ok) {
        clearInlineSuggestion();
        return;
      }

      const payload = (await response.json()) as SuggestionApiResponse;
      const suggestionText = sanitizeInlineSuggestion(
        payload.suggestion ?? payload.sugegstions ?? "",
      );

      if (!suggestionText) {
        clearInlineSuggestion();
        return;
      }

      const latestEditor = editorRef.current;
      if (
        !latestEditor ||
        requestId !== inlineRequestCounterRef.current ||
        abortController.signal.aborted
      ) {
        return;
      }

      const latestModel = latestEditor.getModel();
      const latestPosition = latestEditor.getPosition();
      const latestSelection = latestEditor.getSelection();

      if (!latestModel || !latestPosition) {
        return;
      }

      if (latestSelection && !latestSelection.isEmpty()) {
        clearInlineSuggestion();
        return;
      }

      if (latestModel.uri.toString() !== model.uri.toString()) {
        return;
      }

      if (latestModel.getVersionId() !== modelVersionId) {
        return;
      }

      if (latestModel.getOffsetAt(latestPosition) !== cursorOffset) {
        return;
      }

      inlineSuggestionRef.current = {
        offset: cursorOffset,
        lineNumber: latestPosition.lineNumber,
        column: latestPosition.column,
        modelVersionId,
        text: suggestionText,
      };

      triggerInlineSuggestionWidget();
    } catch {
      if (!abortController.signal.aborted) {
        clearInlineSuggestion();
      }
    } finally {
      if (inlineRequestAbortRef.current === abortController) {
        inlineRequestAbortRef.current = null;
      }
    }
  }, [clearInlineSuggestion, filename, readOnly, triggerInlineSuggestionWidget]);

  const scheduleInlineSuggestion = useCallback(() => {
    if (readOnly) {
      return;
    }

    if (inlineDebounceTimeoutRef.current) {
      clearTimeout(inlineDebounceTimeoutRef.current);
    }

    inlineDebounceTimeoutRef.current = setTimeout(() => {
      inlineDebounceTimeoutRef.current = null;
      void requestInlineSuggestion();
    }, INLINE_SUGGESTION_DEBOUNCE_MS);
  }, [readOnly, requestInlineSuggestion]);

  const registerInlineCompletionsProvider = useCallback(() => {
    const editor = editorRef.current;
    const monacoApi = monacoRef.current;
    if (!editor || !monacoApi) {
      return;
    }

    const model = editor.getModel();
    if (!model) {
      return;
    }

    inlineProviderDisposableRef.current?.dispose();
    inlineProviderDisposableRef.current = monacoApi.languages.registerInlineCompletionsProvider(
      model.getLanguageId(),
      {
        provideInlineCompletions: (providerModel, position) => {
          const suggestion = inlineSuggestionRef.current;
          const activeModel = editorRef.current?.getModel();

          if (!suggestion || !activeModel) {
            return { items: [] };
          }

          if (providerModel.uri.toString() !== activeModel.uri.toString()) {
            return { items: [] };
          }

          if (providerModel.getVersionId() !== suggestion.modelVersionId) {
            return { items: [] };
          }

          if (
            position.lineNumber !== suggestion.lineNumber ||
            position.column !== suggestion.column
          ) {
            return { items: [] };
          }

          if (providerModel.getOffsetAt(position) !== suggestion.offset) {
            return { items: [] };
          }

          return {
            items: [
              {
                insertText: suggestion.text,
                range: new monacoApi.Range(
                  position.lineNumber,
                  position.column,
                  position.lineNumber,
                  position.column,
                ),
                completeBracketPairs: true,
              },
            ],
          };
        },
        freeInlineCompletions: () => {},
      },
    );
  }, []);

  useEffect(() => {
    if (!readOnly) {
      return;
    }

    inlineRequestAbortRef.current?.abort();

    if (inlineDebounceTimeoutRef.current) {
      clearTimeout(inlineDebounceTimeoutRef.current);
      inlineDebounceTimeoutRef.current = null;
    }

    clearInlineSuggestion(true);
  }, [clearInlineSuggestion, readOnly]);

  useEffect(() => {
    registerInlineCompletionsProvider();
  }, [filename, registerInlineCompletionsProvider]);

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
      noSemanticValidation: false,
      noSyntaxValidation: false,
      noSuggestionDiagnostics: false,
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

  const handleMount = useCallback<OnMount>(
    (editor, monacoApi) => {
      editorRef.current = editor;
      monacoRef.current = monacoApi;

      registerInlineCompletionsProvider();

      const acceptInlineSuggestionAction = editor.addAction({
        id: "orbit.inlineSuggest.accept",
        label: "Accept AI inline suggestion",
        keybindings: [monacoApi.KeyCode.Tab],
        precondition: "inlineSuggestionVisible && !editorHasSelection",
        run: () => {
          editor.trigger(
            "orbit-inline",
            "editor.action.inlineSuggest.commit",
            {},
          );
          clearInlineSuggestion(true);
        },
      });

      const hideInlineSuggestionAction = editor.addAction({
        id: "orbit.inlineSuggest.hide",
        label: "Hide AI inline suggestion",
        keybindings: [monacoApi.KeyCode.Escape],
        precondition: "inlineSuggestionVisible",
        run: () => {
          editor.trigger("orbit-inline", "editor.action.inlineSuggest.hide", {});
          clearInlineSuggestion(true);
        },
      });

      disposablesRef.current.forEach((disposable) => disposable.dispose());
      disposablesRef.current = [
        editor.onDidChangeCursorSelection(() => {
          emitState(false);

          const selection = editor.getSelection();
          if (selection && !selection.isEmpty()) {
            clearInlineSuggestion();
            return;
          }

          scheduleInlineSuggestion();
        }),
        editor.onDidChangeModelContent(() => {
          emitState(true);
          clearInlineSuggestion();
          scheduleInlineSuggestion();
        }),
        editor.onDidChangeModel(() => {
          emitState(true);
          inlineRequestAbortRef.current?.abort();
          clearInlineSuggestion(true);
          registerInlineCompletionsProvider();
          scheduleInlineSuggestion();
        }),
        editor.onDidFocusEditorText(() => {
          scheduleInlineSuggestion();
        }),
        editor.onDidBlurEditorText(() => {
          inlineRequestAbortRef.current?.abort();

          if (inlineDebounceTimeoutRef.current) {
            clearTimeout(inlineDebounceTimeoutRef.current);
            inlineDebounceTimeoutRef.current = null;
          }

          clearInlineSuggestion();
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
          scheduleInlineSuggestion();
        }),
        acceptInlineSuggestionAction,
        hideInlineSuggestionAction,
      ];

      restoreInitialState(editor, monacoApi);
      scheduleInlineSuggestion();
    },
    [
      clearInlineSuggestion,
      emitState,
      onBlur,
      registerInlineCompletionsProvider,
      restoreInitialState,
      scheduleInlineSuggestion,
    ],
  );

  const language = useMemo(() => getMonacoLanguage(filename), [filename]);

  const options = useMemo<Monaco.editor.IStandaloneEditorConstructionOptions>(
    () => ({
      automaticLayout: true,
      readOnly,
      wordWrap: settings.wordWrap ? "on" : "off",
      lineNumbers: settings.lineNumbers,
      renderWhitespace: settings.renderWhitespace,
      fontSize: settings.fontSize,
      lineHeight: Math.max(18, Math.round(settings.fontSize * 1.6)),
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
      smoothScrolling: true,
      scrollBeyondLastLine: true,
      scrollBeyondLastColumn: 4,
      cursorBlinking: "blink",
      cursorSmoothCaretAnimation: "on",
      cursorSurroundingLines: 2,
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
      suggestOnTriggerCharacters: true,
      suggestSelection: "first",
      acceptSuggestionOnEnter: "smart",
      inlineSuggest: {
        enabled: !readOnly,
        mode: "subword",
        suppressSuggestions: false,
        showToolbar: "onHover",
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
    [readOnly, settings],
  );

  const handleChange = useCallback(
    (nextValue: string | undefined) => {
      onChange(nextValue ?? "");
    },
    [onChange],
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
          beforeMount={handleBeforeMount}
          height="100%"
          width="100%"
          value={value}
          language={language}
          path={filename}
          theme="vs-dark"
          options={options}
          onMount={handleMount}
          onChange={handleChange}
        />
      </div>
    </EditorContextMenu>
  );
};
