"use client";

import { useCallback, useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  indentOnInput,
  indentUnit,
} from "@codemirror/language";
import { autocompletion, closeBrackets } from "@codemirror/autocomplete";
import { highlightSelectionMatches } from "@codemirror/search";
import { EditorView } from "@codemirror/view";
import { showMinimap } from "@replit/codemirror-minimap";
import { vscodeKeymap } from "@replit/codemirror-vscode-keymap";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";

import { getLanguageExtension } from "../utils/language-detection";
import { editorTheme, editorHighlighting } from "../utils/editor-theme";

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  filename: string;
  readOnly?: boolean;
}

export const CodeEditor = ({
  value,
  onChange,
  filename,
  readOnly = false,
}: CodeEditorProps) => {
  const handleEditorWheelCapture = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      // Keep wheel scrolling contained in the editor like VS Code.
      event.stopPropagation();
    },
    [],
  );

  const extensions = useMemo(() => {
    const langExt = getLanguageExtension(filename);

    return [
      // Theme
      editorTheme,
      editorHighlighting,

      // Language
      ...langExt,

      // Editor behavior
      indentUnit.of("  "),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      foldGutter(),
      highlightSelectionMatches(),
      autocompletion(),
      indentationMarkers({
        hideFirstIndent: true,
        markerType: "codeOnly",
        thickness: 1,
      }),

      // Force editor-internal scrolling similar to VS Code behavior.
      EditorView.theme({
        "&": {
          height: "100%",
          overflow: "hidden",
        },
        ".cm-scroller": {
          height: "100%",
          overflowY: "scroll !important",
          overflowX: "auto !important",
          overscrollBehaviorY: "contain",
          overscrollBehaviorX: "contain",
          scrollbarGutter: "stable",
        },
        ".cm-content": {
          minWidth: "max-content",
        },
        ".cm-minimap-gutter": {
          height: "100%",
        },
      }),

      // Scroll past end — add padding at the bottom
      EditorView.contentAttributes.of({ style: "padding-bottom: 50vh" }),

      // VS Code-like minimap in the right gutter.
      showMinimap.compute(["doc"], () => ({
        create: () => ({ dom: document.createElement("div") }),
        displayText: "blocks",
        showOverlay: "always",
      })),

      // Line wrapping off (like VS Code default)
      // Users can toggle via View menu if needed

      // VS Code keyboard shortcuts.
      keymap.of([...vscodeKeymap, indentWithTab]),

      // Read-only
      ...(readOnly ? [EditorView.editable.of(false)] : []),
    ];
  }, [filename, readOnly]);

  return (
    <div
      className="size-full overflow-hidden [&_.cm-editor]:h-full [&_.cm-editor]:outline-none"
      onWheelCapture={handleEditorWheelCapture}
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme="none"
        height="100%"
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightActiveLine: true,
          history: true,
          drawSelection: true,
          dropCursor: true,
          allowMultipleSelections: true,
          syntaxHighlighting: true,
          defaultKeymap: false,
          historyKeymap: false,
          searchKeymap: false, // We add our own
          foldKeymap: false,
          completionKeymap: false, // We add our own
          lintKeymap: false, // We add our own
          bracketMatching: false, // We add our own
          closeBrackets: false, // We add our own
          autocompletion: false, // We add our own
          crosshairCursor: false,
          rectangularSelection: true,
          highlightSelectionMatches: false, // We add our own
          closeBracketsKeymap: false, // We add our own
          foldGutter: false, // We add our own
          indentOnInput: false, // We add our own
          tabSize: 2,
        }}
      />
    </div>
  );
};
