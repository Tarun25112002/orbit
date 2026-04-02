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
  const disposablesRef = useRef<Monaco.IDisposable[]>([]);
  const lastCursorStateRef = useRef<CursorState | null>(null);
  const lastMetaRef = useRef<EditorRuntimeMeta | null>(null);

  useEffect(() => {
    return () => {
      disposablesRef.current.forEach((disposable) => disposable.dispose());
      disposablesRef.current = [];
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
      } catch {
        // Keep native paste fallback if clipboard permissions are blocked.
      }

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

      disposablesRef.current.forEach((disposable) => disposable.dispose());
      disposablesRef.current = [
        editor.onDidChangeCursorSelection(() => {
          emitState(false);
        }),
        editor.onDidChangeModelContent(() => {
          emitState(true);
        }),
        editor.onDidChangeModel(() => {
          emitState(true);
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
    },
    [emitState, onBlur, restoreInitialState],
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
