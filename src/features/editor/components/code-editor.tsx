"use client";

import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  indentOnInput,
  indentUnit,
} from "@codemirror/language";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { lintKeymap } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { showMinimap } from "@replit/codemirror-minimap";

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

      // Keymaps
      keymap.of([
        ...closeBracketsKeymap,
        ...completionKeymap,
        ...searchKeymap,
        ...lintKeymap,
        indentWithTab,
      ]),

      // Read-only
      ...(readOnly ? [EditorView.editable.of(false)] : []),
    ];
  }, [filename, readOnly]);

  return (
    <div className="size-full overflow-hidden [&_.cm-editor]:h-full [&_.cm-editor]:outline-none [&_.cm-scroller]:overflow-auto">
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
          defaultKeymap: true,
          historyKeymap: true,
          searchKeymap: false, // We add our own
          foldKeymap: true,
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
