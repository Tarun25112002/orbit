"use client";

import { useCallback, useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorSelection, type Text } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightTrailingWhitespace,
  highlightWhitespace,
  lineNumbers,
  rectangularSelection,
  keymap,
} from "@codemirror/view";
import {
  indentWithTab,
  selectAll,
  toggleBlockComment,
  toggleComment,
} from "@codemirror/commands";
import {
  bracketMatching,
  foldCode,
  foldGutter,
  indentOnInput,
  indentUnit,
  unfoldCode,
} from "@codemirror/language";
import { autocompletion, closeBrackets } from "@codemirror/autocomplete";
import {
  gotoLine,
  highlightSelectionMatches,
  openSearchPanel,
  search,
} from "@codemirror/search";
import { vscodeKeymap } from "@replit/codemirror-vscode-keymap";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";

import {
  type CursorState,
  type EditorSettings,
} from "../store/use-editor-store";
import {
  getLanguageExtension,
  getLanguageName,
} from "../utils/language-detection";
import { editorTheme, editorHighlighting } from "../utils/editor-theme";
import { EditorContextMenu } from "./editor-context-menu";

const DEFAULT_SETTINGS: EditorSettings = {
  wordWrap: false,
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

const clampPosition = (doc: Text, position: number) =>
  Math.max(0, Math.min(position, doc.length));

const positionFromLineCol = (doc: Text, line: number, col: number) => {
  const safeLine = Math.max(1, Math.min(line, doc.lines));
  const lineInfo = doc.line(safeLine);
  return clampPosition(doc, lineInfo.from + Math.max(0, col - 1));
};

const getLineEnding = (text: string): "LF" | "CRLF" =>
  text.includes("\r\n") ? "CRLF" : "LF";

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
  const editorRef = useRef<EditorView | null>(null);
  const lastCursorStateRef = useRef<CursorState | null>(null);
  const lastMetaRef = useRef<EditorRuntimeMeta | null>(null);

  const emitState = useCallback(
    (view: EditorView, docChanged = false) => {
      const mainHead = view.state.selection.main.head;
      const lineInfo = view.state.doc.lineAt(mainHead);
      const selections = view.state.selection.ranges.map((range) => ({
        anchor: range.anchor,
        head: range.head,
      }));

      const nextCursorState: CursorState = {
        line: lineInfo.number,
        col: mainHead - lineInfo.from + 1,
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
        totalLines: view.state.doc.lines,
        lineEnding:
          docChanged || !previousMeta
            ? getLineEnding(view.state.doc.toString())
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

  const runEditorCommand = useCallback(
    (command: (view: EditorView) => boolean) => {
      const view = editorRef.current;
      if (!view) return;
      command(view);
      emitState(view);
    },
    [emitState],
  );

  const insertTextAtSelections = useCallback(
    (view: EditorView, text: string) => {
      const changes = view.state.changeByRange((range) => ({
        changes: { from: range.from, to: range.to, insert: text },
        range: EditorSelection.cursor(range.from + text.length),
      }));

      view.dispatch({
        changes: changes.changes,
        selection: changes.selection,
        userEvent: "input.paste",
      });
      emitState(view, true);
    },
    [emitState],
  );

  const executeClipboardAction = useCallback(
    async (action: "copy" | "cut" | "paste") => {
      if (action !== "paste") {
        document.execCommand(action);
        return;
      }

      const view = editorRef.current;
      if (!view || readOnly) {
        return;
      }

      try {
        const text = await navigator.clipboard.readText();
        if (text.length > 0) {
          insertTextAtSelections(view, text);
          return;
        }
      } catch {
        // Keep browser-native paste behavior when clipboard permissions deny access.
      }

      document.execCommand("paste");
    },
    [insertTextAtSelections, readOnly],
  );

  const lineNumberExtensions = useMemo(() => {
    if (settings.lineNumbers === "off") {
      return [];
    }

    return [
      lineNumbers({
        formatNumber: (lineNo, state) => {
          if (settings.lineNumbers !== "relative") {
            return String(lineNo);
          }

          const activeLine = state.doc.lineAt(state.selection.main.head).number;
          if (lineNo === activeLine) {
            return String(lineNo);
          }

          return String(Math.abs(lineNo - activeLine));
        },
      }),
      highlightActiveLineGutter(),
    ];
  }, [settings.lineNumbers]);

  const whitespaceExtensions = useMemo(() => {
    if (settings.renderWhitespace === "none") {
      return [];
    }

    if (settings.renderWhitespace === "boundary") {
      return [highlightTrailingWhitespace()];
    }

    return [highlightWhitespace(), highlightTrailingWhitespace()];
  }, [settings.renderWhitespace]);

  const extensions = useMemo(() => {
    const langExt = getLanguageExtension(filename);

    return [
      editorTheme,
      editorHighlighting,
      ...langExt,
      ...lineNumberExtensions,
      ...whitespaceExtensions,

      indentUnit.of(
        settings.insertSpaces ? " ".repeat(settings.tabSize) : "\t",
      ),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      foldGutter(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      autocompletion(),
      search({ top: true }),
      drawSelection(),
      dropCursor(),
      rectangularSelection(),
      indentationMarkers({
        hideFirstIndent: true,
        markerType: "codeOnly",
        thickness: 1,
      }),

      settings.wordWrap ? EditorView.lineWrapping : [],

      EditorView.theme({
        "&": {
          height: "100%",
          fontSize: `${settings.fontSize}px`,
        },
        ".cm-editor": {
          height: "100%",
          overflow: "hidden",
        },
        ".cm-content": {
          minHeight: "100%",
          minWidth: settings.wordWrap ? "100%" : "max-content",
        },
      }),

      keymap.of([...vscodeKeymap, indentWithTab]),

      readOnly ? EditorView.editable.of(false) : [],
    ];
  }, [
    filename,
    lineNumberExtensions,
    readOnly,
    settings.fontSize,
    settings.insertSpaces,
    settings.tabSize,
    settings.wordWrap,
    whitespaceExtensions,
  ]);

  const restoreInitialState = useCallback(
    (view: EditorView) => {
      if (!initialCursorState) {
        emitState(view);
        return;
      }

      const selections =
        initialCursorState.selections.length > 0
          ? initialCursorState.selections.map((range) =>
              EditorSelection.range(
                clampPosition(view.state.doc, range.anchor),
                clampPosition(view.state.doc, range.head),
              ),
            )
          : [
              EditorSelection.cursor(
                positionFromLineCol(
                  view.state.doc,
                  initialCursorState.line,
                  initialCursorState.col,
                ),
              ),
            ];

      view.dispatch({
        selection: EditorSelection.create(selections, 0),
      });

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          emitState(view);
        });
      });
    },
    [emitState, initialCursorState],
  );

  return (
    <EditorContextMenu
      onCut={() => executeClipboardAction("cut")}
      onCopy={() => executeClipboardAction("copy")}
      onPaste={() => executeClipboardAction("paste")}
      onSelectAll={() => runEditorCommand(selectAll)}
      onFind={() => runEditorCommand(openSearchPanel)}
      onReplace={() => runEditorCommand(openSearchPanel)}
      onGoToLine={() => runEditorCommand(gotoLine)}
      onToggleLineComment={() => runEditorCommand(toggleComment)}
      onToggleBlockComment={() => runEditorCommand(toggleBlockComment)}
      onFold={() => runEditorCommand(foldCode)}
      onUnfold={() => runEditorCommand(unfoldCode)}
      onFormatDocument={() => {
        // Formatting requires external formatter wiring by language.
      }}
    >
      <div className="flex size-full overflow-hidden">
        <div className="flex-1 h-full overflow-hidden [&_.cm-editor]:h-full [&_.cm-editor]:outline-none">
          <CodeMirror
            value={value}
            onChange={onChange}
            extensions={extensions}
            theme="none"
            onCreateEditor={(view) => {
              editorRef.current = view;
              restoreInitialState(view);

              requestAnimationFrame(() => {
                view.requestMeasure();
              });
            }}
            onUpdate={(update) => {
              if (update.view !== editorRef.current) {
                editorRef.current = update.view;
              }

              if (
                update.docChanged ||
                update.selectionSet ||
                update.viewportChanged ||
                update.geometryChanged
              ) {
                emitState(update.view, update.docChanged);
              }
            }}
            basicSetup={{
              lineNumbers: false,
              highlightActiveLineGutter: false,
              highlightActiveLine: false,
              history: true,
              drawSelection: false,
              dropCursor: false,
              allowMultipleSelections: true,
              syntaxHighlighting: true,
              defaultKeymap: false,
              historyKeymap: false,
              searchKeymap: false,
              foldKeymap: false,
              completionKeymap: false,
              lintKeymap: false,
              bracketMatching: false,
              closeBrackets: false,
              autocompletion: false,
              crosshairCursor: false,
              rectangularSelection: false,
              highlightSelectionMatches: false,
              closeBracketsKeymap: false,
              foldGutter: false,
              indentOnInput: false,
              tabSize: settings.tabSize,
            }}
          />
        </div>
      </div>
    </EditorContextMenu>
  );
};
