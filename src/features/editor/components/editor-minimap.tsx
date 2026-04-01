"use client";

import {
  useRef,
  useEffect,
  useCallback,
  useState,
  useMemo,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";

export type TokenType =
  | "keyword"
  | "string"
  | "comment"
  | "number"
  | "operator"
  | "punctuation"
  | "function"
  | "type"
  | "variable"
  | "tag"
  | "attribute"
  | "default";

export interface Token {
  text: string;
  type: TokenType;
}

export interface MinimapTheme {
  keyword: string;
  string: string;
  comment: string;
  number: string;
  operator: string;
  punctuation: string;
  function: string;
  type: string;
  variable: string;
  tag: string;
  attribute: string;
  default: string;
}

interface MinimapState {
  canvasOffset: number;
  sliderTop: number;
  sliderHeight: number;
}

interface EditorMinimapProps {
  code: string;
  editorElement: HTMLElement | null;
  width?: number;
  lineHeight?: number;
  charWidth?: number;
  maxLineChars?: number;
  backgroundColor?: string;
  sliderColor?: string;
  sliderHoverColor?: string;
  sliderActiveColor?: string;
  sliderBorderColor?: string;
  hoverHighlightColor?: string;
  minSliderHeight?: number;
  theme?: Partial<MinimapTheme>;
  className?: string;
  style?: CSSProperties;
  onScroll?: (scrollTop: number) => void;
  onNavigate?: (scrollTop: number) => void;
}

export const DARK_THEME: MinimapTheme = {
  keyword: "#569CD6",
  string: "#CE9178",
  comment: "#6A9955",
  number: "#B5CEA8",
  operator: "#D4D4D4",
  punctuation: "#808080",
  function: "#DCDCAA",
  type: "#4EC9B0",
  variable: "#9CDCFE",
  tag: "#569CD6",
  attribute: "#9CDCFE",
  default: "#D4D4D4",
};

const KEYWORDS = new Set([
  "abstract",
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "get",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "of",
  "package",
  "private",
  "protected",
  "public",
  "readonly",
  "return",
  "set",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

const BUILTIN_TYPES = new Set([
  "string",
  "number",
  "boolean",
  "any",
  "void",
  "never",
  "unknown",
  "object",
  "symbol",
  "bigint",
  "Array",
  "Map",
  "Set",
  "Promise",
  "Record",
  "Partial",
  "Required",
  "Pick",
  "Omit",
  "Exclude",
  "Extract",
  "ReturnType",
  "React",
  "HTMLElement",
  "HTMLDivElement",
  "HTMLCanvasElement",
  "MouseEvent",
  "KeyboardEvent",
  "CSSProperties",
  "FC",
  "RefObject",
]);

export function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < line.length) {
    const ch = line[i];

    if (/\s/.test(ch)) {
      const start = i;
      while (i < line.length && /\s/.test(line[i])) i++;
      tokens.push({ text: line.slice(start, i), type: "default" });
      continue;
    }

    if (ch === "/" && line[i + 1] === "/") {
      tokens.push({ text: line.slice(i), type: "comment" });
      i = line.length;
      continue;
    }

    if (ch === "/" && line[i + 1] === "*") {
      const end = line.indexOf("*/", i + 2);
      const stop = end === -1 ? line.length : end + 2;
      tokens.push({ text: line.slice(i, stop), type: "comment" });
      i = stop;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      const start = i;
      i++;
      while (i < line.length && line[i] !== quote) {
        if (line[i] === "\\") i++;
        i++;
      }
      if (i < line.length) i++;
      tokens.push({ text: line.slice(start, i), type: "string" });
      continue;
    }

    if (ch === "<" && i + 1 < line.length && /[A-Za-z/]/.test(line[i + 1])) {
      tokens.push({ text: "<", type: "punctuation" });
      i++;
      if (line[i] === "/") {
        tokens.push({ text: "/", type: "punctuation" });
        i++;
      }
      const start = i;
      while (i < line.length && /[A-Za-z0-9._]/.test(line[i])) i++;
      if (i > start) {
        tokens.push({ text: line.slice(start, i), type: "tag" });
      }
      continue;
    }

    if (/[0-9]/.test(ch)) {
      const start = i;
      while (i < line.length && /[0-9.xXa-fA-F_n]/.test(line[i])) i++;
      tokens.push({ text: line.slice(start, i), type: "number" });
      continue;
    }

    if (/[a-zA-Z_$]/.test(ch)) {
      const start = i;
      while (i < line.length && /[a-zA-Z0-9_$]/.test(line[i])) i++;
      const word = line.slice(start, i);

      let type: TokenType = "variable";
      if (KEYWORDS.has(word)) type = "keyword";
      else if (BUILTIN_TYPES.has(word)) type = "type";
      else if (i < line.length && line[i] === "(") type = "function";
      else if (/^[A-Z]/.test(word) && word.length > 1) type = "type";

      tokens.push({ text: word, type });
      continue;
    }

    if (ch === "@") {
      const start = i;
      i++;
      while (i < line.length && /[a-zA-Z0-9_]/.test(line[i])) i++;
      tokens.push({ text: line.slice(start, i), type: "function" });
      continue;
    }

    if (/[+\-*/%=<>!&|^~?:]/.test(ch)) {
      const start = i;
      while (i < line.length && /[+\-*/%=<>!&|^~?:]/.test(line[i])) i++;
      tokens.push({ text: line.slice(start, i), type: "operator" });
      continue;
    }

    if (/[{}()\[\];,.]/.test(ch)) {
      tokens.push({ text: ch, type: "punctuation" });
      i++;
      continue;
    }

    tokens.push({ text: ch, type: "default" });
    i++;
  }

  return tokens;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeMinimapState(
  editorScrollTop: number,
  editorScrollHeight: number,
  editorClientHeight: number,
  minimapContentHeight: number,
  containerHeight: number,
  minSliderH: number,
): MinimapState {
  if (editorScrollHeight <= 0 || editorClientHeight >= editorScrollHeight) {
    return {
      canvasOffset: 0,
      sliderTop: 0,
      sliderHeight: Math.min(containerHeight, minimapContentHeight),
    };
  }

  const editorScrollRange = editorScrollHeight - editorClientHeight;
  const scrollRatio =
    editorScrollRange > 0
      ? clamp(editorScrollTop / editorScrollRange, 0, 1)
      : 0;

  const rawSliderH =
    (editorClientHeight / editorScrollHeight) * minimapContentHeight;
  const sliderHeight = Math.max(rawSliderH, minSliderH);

  if (minimapContentHeight <= containerHeight) {
    const sliderRange = Math.max(minimapContentHeight - sliderHeight, 0);
    return {
      canvasOffset: 0,
      sliderTop: scrollRatio * sliderRange,
      sliderHeight,
    };
  }

  const minimapScrollRange = minimapContentHeight - containerHeight;
  const canvasOffset = scrollRatio * minimapScrollRange;
  const sliderRange = Math.max(containerHeight - sliderHeight, 0);

  return {
    canvasOffset,
    sliderTop: scrollRatio * sliderRange,
    sliderHeight,
  };
}

export const EditorMinimap = ({
  code,
  editorElement,
  width = 80,
  lineHeight = 3,
  charWidth = 1.6,
  maxLineChars = 100,
  backgroundColor = "#1e1e1e",
  sliderColor = "rgba(200, 210, 231, 0.10)",
  sliderHoverColor = "rgba(200, 210, 231, 0.18)",
  sliderActiveColor = "rgba(200, 210, 231, 0.30)",
  sliderBorderColor = "rgba(100, 150, 255, 0.55)",
  hoverHighlightColor = "rgba(200, 210, 231, 0.12)",
  minSliderHeight = 25,
  theme,
  className,
  style,
  onScroll,
  onNavigate,
}: EditorMinimapProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const editorElementRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{
    active: boolean;
    startY: number;
    startScrollTop: number;
  }>({ active: false, startY: 0, startScrollTop: 0 });

  const [containerH, setContainerH] = useState(0);
  const [hoverY, setHoverY] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [mmState, setMmState] = useState<MinimapState>({
    canvasOffset: 0,
    sliderTop: 0,
    sliderHeight: 50,
  });

  const colors = useMemo<MinimapTheme>(
    () => ({ ...DARK_THEME, ...theme }),
    [theme],
  );

  const lines = useMemo(() => code.split("\n"), [code]);
  const tokenizedLines = useMemo(() => lines.map(tokenizeLine), [lines]);
  const minimapContentHeight = lines.length * lineHeight;

  useEffect(() => {
    editorElementRef.current = editorElement;
  }, [editorElement]);

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cw = width;
    const ch = minimapContentHeight;

    canvas.width = Math.ceil(cw * dpr);
    canvas.height = Math.ceil(ch * dpr);
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cw, ch);

    tokenizedLines.forEach((tokens, lineIdx) => {
      let x = 0;
      const y = lineIdx * lineHeight;

      for (const token of tokens) {
        ctx.fillStyle = colors[token.type] ?? colors.default;
        ctx.globalAlpha = token.type === "comment" ? 0.5 : 0.78;

        for (let ci = 0; ci < token.text.length; ci++) {
          if (x >= maxLineChars * charWidth) break;

          const c = token.text[ci];
          if (c === "\t") {
            x += charWidth * 4;
            continue;
          }
          if (c === " ") {
            x += charWidth;
            continue;
          }

          ctx.fillRect(
            x,
            y + 0.5,
            Math.max(charWidth - 0.4, 0.8),
            lineHeight - 1,
          );
          x += charWidth;
        }
      }
    });

    ctx.globalAlpha = 1;
  }, [
    tokenizedLines,
    colors,
    width,
    lineHeight,
    charWidth,
    maxLineChars,
    minimapContentHeight,
  ]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  const syncViewport = useCallback(() => {
    const currentEditor = editorElementRef.current;
    if (!currentEditor) return;
    const { scrollTop, scrollHeight, clientHeight } = currentEditor;
    setMmState(
      computeMinimapState(
        scrollTop,
        scrollHeight,
        clientHeight,
        minimapContentHeight,
        containerH,
        minSliderHeight,
      ),
    );
  }, [minimapContentHeight, containerH, minSliderHeight]);

  useEffect(() => {
    if (!editorElement || !containerRef.current) return;

    const currentEditor = editorElement;

    const measure = () => {
      if (containerRef.current) {
        setContainerH(containerRef.current.clientHeight);
      }
    };
    measure();

    const onScroll = () => syncViewport();
    currentEditor.addEventListener("scroll", onScroll, { passive: true });

    const ro = new ResizeObserver(() => {
      measure();
      syncViewport();
    });
    ro.observe(currentEditor);
    ro.observe(containerRef.current);

    return () => {
      currentEditor.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [editorElement, syncViewport]);

  useEffect(() => {
    syncViewport();
  }, [containerH, syncViewport]);

  useEffect(() => {
    const container = containerRef.current;
    const currentEditor = editorElementRef.current;
    if (!container || !currentEditor) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      currentEditor.scrollTop += event.deltaY;
      onScroll?.(currentEditor.scrollTop);
      onNavigate?.(currentEditor.scrollTop);
    };

    container.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      container.removeEventListener("wheel", handleWheel);
    };
  }, [onNavigate, onScroll, editorElement]);

  const isOverSlider =
    hoverY !== null &&
    hoverY >= mmState.sliderTop &&
    hoverY <= mmState.sliderTop + mmState.sliderHeight;

  const hoverRect = useMemo(() => {
    if (hoverY === null || isDragging || isOverSlider) {
      return null;
    }

    return {
      top: clamp(
        hoverY - mmState.sliderHeight / 2,
        0,
        containerH - mmState.sliderHeight,
      ),
      height: mmState.sliderHeight,
    };
  }, [hoverY, isDragging, isOverSlider, mmState.sliderHeight, containerH]);

  const scrollEditorTo = useCallback(
    (containerY: number) => {
      const currentEditor = editorElementRef.current;
      if (!currentEditor) return;
      const { scrollHeight, clientHeight } = currentEditor;
      const contentY = containerY + mmState.canvasOffset;
      const ratio = contentY / minimapContentHeight;
      const target = ratio * scrollHeight - clientHeight / 2;
      const clamped = clamp(target, 0, scrollHeight - clientHeight);
      currentEditor.scrollTop = clamped;
      onScroll?.(clamped);
      onNavigate?.(clamped);
    },
    [mmState.canvasOffset, minimapContentHeight, onNavigate, onScroll],
  );

  const handleMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const currentEditor = editorElementRef.current;
      if (!containerRef.current || !currentEditor) return;

      const rect = containerRef.current.getBoundingClientRect();
      const y = e.clientY - rect.top;

      const inSlider =
        y >= mmState.sliderTop && y <= mmState.sliderTop + mmState.sliderHeight;

      if (inSlider) {
        dragRef.current = {
          active: true,
          startY: e.clientY,
          startScrollTop: currentEditor.scrollTop,
        };
        setIsDragging(true);
      } else {
        scrollEditorTo(y);
        requestAnimationFrame(() => {
          const nextEditor = editorElementRef.current;
          if (nextEditor) {
            dragRef.current = {
              active: true,
              startY: e.clientY,
              startScrollTop: nextEditor.scrollTop,
            };
            setIsDragging(true);
          }
        });
      }
    },
    [mmState.sliderTop, mmState.sliderHeight, scrollEditorTo],
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (e: MouseEvent) => {
      const currentEditor = editorElementRef.current;
      if (!currentEditor || !dragRef.current.active) return;

      const { scrollHeight, clientHeight } = currentEditor;
      const editorScrollRange = scrollHeight - clientHeight;
      if (editorScrollRange <= 0) return;

      const effectiveRange =
        Math.min(minimapContentHeight, containerH) - mmState.sliderHeight;
      if (effectiveRange <= 0) return;

      const deltaY = e.clientY - dragRef.current.startY;
      const scrollDelta = (deltaY / effectiveRange) * editorScrollRange;
      const newScroll = clamp(
        dragRef.current.startScrollTop + scrollDelta,
        0,
        editorScrollRange,
      );
      currentEditor.scrollTop = newScroll;
      onScroll?.(newScroll);
      onNavigate?.(newScroll);
    };

    const handleUp = () => {
      dragRef.current.active = false;
      setIsDragging(false);
      setHoverY(null);
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };
  }, [
    isDragging,
    minimapContentHeight,
    containerH,
    mmState.sliderHeight,
    onScroll,
    onNavigate,
  ]);

  const currentSliderColor = isDragging
    ? sliderActiveColor
    : isOverSlider
      ? sliderHoverColor
      : sliderColor;

  const handleMouseMove = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!containerRef.current || isDragging) return;
      const rect = containerRef.current.getBoundingClientRect();
      setHoverY(event.clientY - rect.top);
    },
    [isDragging],
  );

  const handleMouseLeave = useCallback(() => {
    if (!isDragging) {
      setHoverY(null);
    }
  }, [isDragging]);

  return (
    <div
      ref={containerRef}
      className={className}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        position: "relative",
        width,
        height: "100%",
        backgroundColor,
        overflow: "hidden",
        cursor: isDragging ? "grabbing" : "default",
        userSelect: "none",
        flexShrink: 0,
        borderLeft: "1px solid rgba(255,255,255,0.06)",
        ...style,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          top: 0,
          left: 4,
          pointerEvents: "none",
          transform: `translateY(${-mmState.canvasOffset}px)`,
          willChange: "transform",
        }}
      />

      {hoverRect ? (
        <div
          style={{
            position: "absolute",
            top: hoverRect.top,
            left: 0,
            width: "100%",
            height: hoverRect.height,
            backgroundColor: hoverHighlightColor,
            pointerEvents: "none",
          }}
        />
      ) : null}

      <div
        style={{
          position: "absolute",
          top: mmState.sliderTop,
          left: 0,
          width: "100%",
          height: mmState.sliderHeight,
          backgroundColor: currentSliderColor,
          borderLeft: `2px solid ${sliderBorderColor}`,
          boxSizing: "border-box",
          transition: isDragging
            ? "none"
            : "background-color 0.15s ease, top 0.04s linear",
          pointerEvents: "none",
          borderRadius: 1,
        }}
      />
    </div>
  );
};
