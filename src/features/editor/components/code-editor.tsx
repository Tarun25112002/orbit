"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import MonacoEditor, { type OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";

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
      ];

      restoreInitialState(editor, monacoApi);
    },
    [emitState, restoreInitialState],
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
      tabSize: settings.tabSize,
      insertSpaces: settings.insertSpaces,
      minimap: {
        enabled: settings.minimap,
        showSlider: "always",
        renderCharacters: true,
        autohide: "none",
      },
      scrollbar: {
        alwaysConsumeMouseWheel: false,
      },
      smoothScrolling: true,
      scrollBeyondLastLine: true,
      cursorBlinking: "blink",
      folding: true,
      contextmenu: false,
      quickSuggestions: {
        other: true,
        comments: true,
        strings: true,
      },
      suggestOnTriggerCharacters: true,
      guides: {
        indentation: true,
        highlightActiveIndentation: true,
      },
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
      onSelectAll={() => runEditorAction("editor.action.selectAll")}
      onFind={() => runEditorAction("actions.find")}
      onReplace={() => runEditorAction("editor.action.startFindReplaceAction")}
      onGoToLine={() => runEditorAction("editor.action.gotoLine")}
      onToggleLineComment={() => runEditorAction("editor.action.commentLine")}
      onToggleBlockComment={() => runEditorAction("editor.action.blockComment")}
      onFold={() => runEditorAction("editor.fold")}
      onUnfold={() => runEditorAction("editor.unfold")}
      onFormatDocument={() => runEditorAction("editor.action.formatDocument")}
    >
      <div className="size-full overflow-hidden">
        <MonacoEditor
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
