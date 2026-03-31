import { EditorView } from "@codemirror/view";
import { Extension } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/**
 * VS Code Dark+ inspired theme for CodeMirror 6.
 * Colors match the app's dark aesthetic.
 */

const bg = "#0a0a0a";
const fg = "#d4d4d4";
const gutterBg = "#0a0a0a";
const gutterFg = "#858585";
const gutterActiveFg = "#c6c6c6";
const selectionBg = "#264f78";
const activeLineBg = "#ffffff08";
const cursorColor = "#aeafad";
const matchingBracketBg = "#0064001a";
const matchingBracketBorder = "#888888";
const lineNumberColor = "#6e7681";
const searchMatchBg = "#623315";
const searchMatchSelectedBg = "#9e6a03";
const foldPlaceholderColor = "#7a7a7a";
const tooltipBg = "#1e1e1e";
const tooltipBorder = "#454545";

export const editorTheme: Extension = EditorView.theme(
  {
    "&": {
      color: fg,
      backgroundColor: bg,
      fontSize: "13px",
      fontFamily:
        "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', 'Courier New', monospace",
    },
    ".cm-content": {
      caretColor: cursorColor,
      padding: "4px 0",
      fontFamily: "inherit",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: cursorColor,
      borderLeftWidth: "2px",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      {
        backgroundColor: selectionBg,
      },
    ".cm-activeLine": {
      backgroundColor: activeLineBg,
    },
    ".cm-selectionMatch": {
      backgroundColor: "#add6ff26",
    },
    ".cm-matchingBracket": {
      backgroundColor: matchingBracketBg,
      outline: `1px solid ${matchingBracketBorder}`,
    },
    ".cm-nonmatchingBracket": {
      color: "#f44747",
    },
    ".cm-gutters": {
      backgroundColor: gutterBg,
      color: gutterFg,
      border: "none",
      paddingRight: "4px",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
      color: gutterActiveFg,
    },
    ".cm-lineNumbers .cm-gutterElement": {
      color: lineNumberColor,
      padding: "0 12px 0 20px",
      minWidth: "3.5em",
      fontSize: "12px",
    },
    ".cm-foldGutter .cm-gutterElement": {
      padding: "0 4px",
      cursor: "pointer",
      color: foldPlaceholderColor,
      transition: "color 0.15s",
      "&:hover": {
        color: fg,
      },
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "transparent",
      border: `1px solid ${foldPlaceholderColor}`,
      color: foldPlaceholderColor,
      borderRadius: "3px",
      padding: "0 6px",
      margin: "0 4px",
      cursor: "pointer",
      fontSize: "11px",
    },
    ".cm-searchMatch": {
      backgroundColor: searchMatchBg,
      outline: `1px solid ${searchMatchBg}`,
      borderRadius: "2px",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: searchMatchSelectedBg,
      outline: `1px solid ${searchMatchSelectedBg}`,
    },
    ".cm-tooltip": {
      backgroundColor: tooltipBg,
      border: `1px solid ${tooltipBorder}`,
      borderRadius: "4px",
      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.5)",
    },
    ".cm-tooltip-autocomplete": {
      "& > ul > li": {
        padding: "2px 8px",
        fontSize: "13px",
      },
      "& > ul > li[aria-selected]": {
        backgroundColor: "#04395e",
        color: "#ffffff",
      },
    },
    ".cm-panels": {
      backgroundColor: "#252526",
      color: fg,
    },
    ".cm-panels.cm-panels-top": {
      borderBottom: "1px solid #454545",
    },
    ".cm-panel.cm-search": {
      padding: "6px 8px",
      "& input, & button, & label": {
        fontSize: "12px",
      },
      "& input": {
        backgroundColor: "#3c3c3c",
        color: fg,
        border: "1px solid #3c3c3c",
        borderRadius: "3px",
        padding: "3px 6px",
        "&:focus": {
          borderColor: "#007fd4",
          outline: "none",
        },
      },
      "& button": {
        backgroundColor: "transparent",
        color: fg,
        border: "none",
        borderRadius: "3px",
        padding: "3px 8px",
        cursor: "pointer",
        "&:hover": {
          backgroundColor: "#ffffff15",
        },
      },
    },
    ".cm-scroller": {
      fontFamily: "inherit",
      lineHeight: "1.6",
      "&::-webkit-scrollbar": {
        width: "10px",
        height: "10px",
      },
      "&::-webkit-scrollbar-track": {
        background: "transparent",
      },
      "&::-webkit-scrollbar-thumb": {
        background: "#424242",
        borderRadius: "5px",
        "&:hover": {
          background: "#555555",
        },
      },
    },
    ".cm-indent-markers::before": {
      borderColor: "#404040",
    },
  },
  { dark: true },
);

const highlightStyle = HighlightStyle.define([
  // Comments
  { tag: t.comment, color: "#6a9955" },
  { tag: t.lineComment, color: "#6a9955" },
  { tag: t.blockComment, color: "#6a9955" },
  { tag: t.docComment, color: "#6a9955" },

  // Strings
  { tag: t.string, color: "#ce9178" },
  { tag: t.special(t.string), color: "#d7ba7d" },
  { tag: t.regexp, color: "#d16969" },

  // Numbers & booleans
  { tag: t.number, color: "#b5cea8" },
  { tag: t.bool, color: "#569cd6" },
  { tag: t.null, color: "#569cd6" },

  // Keywords
  { tag: t.keyword, color: "#c586c0" },
  { tag: t.controlKeyword, color: "#c586c0" },
  { tag: t.operatorKeyword, color: "#c586c0" },
  { tag: t.definitionKeyword, color: "#569cd6" },
  { tag: t.moduleKeyword, color: "#c586c0" },

  // Operators & punctuation
  { tag: t.operator, color: "#d4d4d4" },
  { tag: t.punctuation, color: "#d4d4d4" },
  { tag: t.bracket, color: "#ffd700" },
  { tag: t.angleBracket, color: "#808080" },
  { tag: t.squareBracket, color: "#d4d4d4" },

  // Variables & properties
  { tag: t.variableName, color: "#9cdcfe" },
  { tag: t.definition(t.variableName), color: "#9cdcfe" },
  { tag: t.propertyName, color: "#9cdcfe" },
  { tag: t.definition(t.propertyName), color: "#9cdcfe" },
  { tag: t.special(t.variableName), color: "#4ec9b0" },

  // Functions
  {
    tag: [t.function(t.variableName), t.function(t.propertyName)],
    color: "#dcdcaa",
  },

  // Types & classes
  { tag: t.typeName, color: "#4ec9b0" },
  { tag: t.className, color: "#4ec9b0" },
  { tag: t.namespace, color: "#4ec9b0" },

  // Tags (HTML/JSX)
  { tag: t.tagName, color: "#569cd6" },
  { tag: t.attributeName, color: "#9cdcfe" },
  { tag: t.attributeValue, color: "#ce9178" },

  // Markdown
  { tag: t.heading, color: "#569cd6", fontWeight: "bold" },
  { tag: t.heading1, color: "#569cd6", fontWeight: "bold", fontSize: "1.3em" },
  { tag: t.heading2, color: "#569cd6", fontWeight: "bold", fontSize: "1.2em" },
  {
    tag: t.heading3,
    color: "#569cd6",
    fontWeight: "bold",
    fontSize: "1.1em",
  },
  { tag: t.link, color: "#569cd6", textDecoration: "underline" },
  { tag: t.url, color: "#569cd6" },
  { tag: t.emphasis, fontStyle: "italic", color: "#d4d4d4" },
  { tag: t.strong, fontWeight: "bold", color: "#d4d4d4" },
  { tag: t.strikethrough, textDecoration: "line-through" },

  // Meta & misc
  { tag: t.meta, color: "#569cd6" },
  { tag: t.atom, color: "#569cd6" },
  { tag: t.labelName, color: "#c8c8c8" },
  { tag: t.inserted, color: "#b5cea8" },
  { tag: t.deleted, color: "#ce9178" },
  { tag: t.changed, color: "#569cd6" },
  { tag: t.invalid, color: "#f44747" },
]);

export const editorHighlighting: Extension =
  syntaxHighlighting(highlightStyle);
