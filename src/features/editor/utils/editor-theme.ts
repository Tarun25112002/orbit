import { EditorView } from "@codemirror/view";
import { type Extension } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

const bg = "#1e1e1e";
const fg = "#d4d4d4";
const selectionBg = "#264f78";
const inactiveSelectionBg = "#3a3d41";
const activeLineBg = "#ffffff0a";
const cursorColor = "#aeafad";
const lineNumberColor = "#858585";
const activeLineNumberColor = "#c6c6c6";
const tooltipBg = "#252526";
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
      lineHeight: "20px",
      fontFamily: "inherit",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: cursorColor,
      borderLeftWidth: "2px",
      transition: "opacity 120ms ease-in-out",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      {
        backgroundColor: selectionBg,
      },
    ".cm-selectionBackground": {
      backgroundColor: inactiveSelectionBg,
    },
    "&.cm-focused .cm-selectionBackground": {
      backgroundColor: selectionBg,
    },
    ".cm-activeLine": {
      backgroundColor: activeLineBg,
      boxShadow: "inset 0 1px 0 #ffffff10, inset 0 -1px 0 #00000020",
    },
    ".cm-selectionMatch": {
      backgroundColor: "#add6ff26",
      border: "1px solid #add6ff4d",
      borderRadius: "2px",
    },
    ".cm-matchingBracket": {
      backgroundColor: "#0064001a",
      outline: "1px solid #888888",
    },
    ".cm-nonmatchingBracket": {
      color: "#f44747",
    },
    ".cm-gutters": {
      backgroundColor: bg,
      border: "none",
      color: lineNumberColor,
      paddingRight: "2px",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
      color: activeLineNumberColor,
    },
    ".cm-lineNumbers .cm-gutterElement": {
      color: lineNumberColor,
      padding: "0 12px 0 20px",
      minWidth: "3.5em",
      textAlign: "right",
      fontSize: "13px",
      lineHeight: "20px",
    },
    ".cm-foldGutter": {
      width: "14px",
    },
    ".cm-foldGutter .cm-gutterElement": {
      padding: "0 2px",
      width: "14px",
      height: "14px",
      cursor: "pointer",
      borderRadius: "2px",
      transition: "background-color 120ms ease",
      "&:hover": {
        backgroundColor: "#ffffff15",
      },
    },
    ".cm-tooltip": {
      backgroundColor: tooltipBg,
      border: `1px solid ${tooltipBorder}`,
      borderRadius: "3px",
      boxShadow: "0 2px 8px rgba(0, 0, 0, 0.36)",
      padding: "0",
      fontSize: "13px",
      fontFamily: "inherit",
    },
    ".cm-tooltip-autocomplete": {
      "& > ul": {
        maxHeight: "300px",
        padding: "2px 0",
      },
      "& > ul > li": {
        padding: "2px 4px 2px 8px",
        lineHeight: "22px",
        display: "flex",
        alignItems: "center",
      },
      "& > ul > li[aria-selected]": {
        backgroundColor: "#04395e",
        color: "#ffffff",
      },
    },
    ".cm-panels": {
      backgroundColor: "#252526",
      color: fg,
      zIndex: "10",
    },
    ".cm-panels-top": {
      borderBottom: "none",
    },
    ".cm-panel.cm-search": {
      backgroundColor: "#252526",
      boxShadow: "0 2px 8px rgba(0, 0, 0, 0.36)",
      padding: "4px 12px 4px 8px",
      display: "flex",
      gap: "4px",
      flexWrap: "wrap",
      alignItems: "center",
      "& input": {
        backgroundColor: "#3c3c3c",
        color: fg,
        border: "1px solid #3c3c3c",
        borderRadius: "3px",
        padding: "3px 6px",
        height: "24px",
        outline: "none",
      },
      "& input:focus": {
        borderColor: "#007fd4",
      },
      "& button": {
        backgroundColor: "transparent",
        color: fg,
        border: "none",
        borderRadius: "3px",
        padding: "3px 8px",
        height: "24px",
        cursor: "pointer",
      },
      "& button:hover": {
        backgroundColor: "#ffffff15",
      },
      "& br": {
        display: "none",
      },
    },
    ".cm-scroller": {
      lineHeight: "20px",
      overflowY: "auto",
      overflowX: "auto",
      overscrollBehavior: "contain",
      scrollbarGutter: "stable",
      "&::-webkit-scrollbar": {
        width: "14px",
        height: "14px",
      },
      "&::-webkit-scrollbar-track": {
        backgroundColor: "#1a1a1a",
      },
      "&::-webkit-scrollbar-thumb": {
        backgroundColor: "#4b4b4b",
        borderRadius: "7px",
        border: "3px solid #1a1a1a",
      },
      "&::-webkit-scrollbar-thumb:hover": {
        backgroundColor: "#646464",
      },
    },
    ".cm-indent-markers::before": {
      borderColor: "#2f3440",
    },
    ".cm-indent-markers-active::before": {
      borderColor: "#4a90e2",
    },
    ".cm-minimap-gutter": {
      backgroundColor: "#1f1f1f",
      borderLeft: "1px solid #2b2b2b",
      width: "120px",
    },
    ".cm-minimap-inner": {
      background: "linear-gradient(180deg, #1f1f1f 0%, #1b1b1b 100%)",
    },
    ".cm-minimap-inner canvas": {
      filter: "saturate(1.25) contrast(1.08)",
      opacity: "0.95",
    },
    ".cm-minimap-overlay": {
      background: "rgba(128, 138, 158, 0.22) !important",
      border: "1px solid rgba(173, 216, 255, 0.25)",
      boxSizing: "border-box",
      backdropFilter: "blur(1px)",
    },
    ".cm-minimap-overlay-container.cm-minimap-overlay-active .cm-minimap-overlay":
      {
        background: "rgba(107, 163, 255, 0.28) !important",
        borderColor: "rgba(156, 201, 255, 0.35)",
      },
  },
  { dark: true },
);

const highlightStyle = HighlightStyle.define([
  { tag: t.comment, color: "#6a9955" },
  { tag: t.string, color: "#ce9178" },
  { tag: t.number, color: "#b5cea8" },
  { tag: [t.bool, t.null], color: "#569cd6" },
  { tag: t.keyword, color: "#c586c0" },
  { tag: t.operator, color: "#d4d4d4" },
  { tag: t.punctuation, color: "#d4d4d4" },
  { tag: t.variableName, color: "#9cdcfe" },
  { tag: t.propertyName, color: "#9cdcfe" },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName)],
    color: "#dcdcaa",
  },
  { tag: [t.typeName, t.className, t.namespace], color: "#4ec9b0" },
  { tag: t.tagName, color: "#569cd6" },
  { tag: t.attributeName, color: "#9cdcfe" },
  { tag: t.attributeValue, color: "#ce9178" },
  { tag: t.link, color: "#569cd6", textDecoration: "underline" },
  { tag: t.heading, color: "#569cd6", fontWeight: "bold" },
  { tag: t.meta, color: "#569cd6" },
  { tag: t.invalid, color: "#f44747" },
]);

export const editorHighlighting: Extension = syntaxHighlighting(highlightStyle);
