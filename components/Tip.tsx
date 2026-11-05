"use client";

// 말풍선 툴팁
//  - 글자 툴팁:   <Tip content="설명">…</Tip>
//  - 리치 툴팁:   <Tip title="제목" content={<>여러 줄 · 목록</>}>…</Tip>
//  - 인터랙티브:  <Tip interactive content={<a href=…>링크</a>}>…</Tip>  (말풍선 위로 마우스를 옮겨 누를 수 있음)
//  - 도움말 아이콘: <Help title="…" content="…" />
import { cloneElement, isValidElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Side = "top" | "bottom" | "left" | "right";

export function Tip({
  content,
  title,
  children,
  side = "top",
  interactive = false,
  width = 260,
  delay = 200,
  disabled,
}: {
  content: React.ReactNode;
  title?: React.ReactNode;
  children: React.ReactNode;
  side?: Side;
  interactive?: boolean;
  /** 최대 너비(px) */
  width?: number;
  delay?: number;
  disabled?: boolean;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; side: Side; arrow: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const show = useCallback(() => {
    if (disabled) return;
    clear();
    timer.current = setTimeout(() => setOpen(true), delay);
  }, [delay, disabled]);
  const hide = useCallback(() => {
    clear();
    timer.current = setTimeout(() => setOpen(false), interactive ? 160 : 0);
  }, [interactive]);

  useEffect(() => () => clear(), []);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  // 화면 밖으로 나가지 않게 자리 잡기
  useLayoutEffect(() => {
    if (!open || !anchor.current || !bubble.current) return;
    const a = anchor.current.getBoundingClientRect();
    const b = bubble.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 8;
    let s: Side = side;
    if (s === "top" && a.top - b.height - gap < 4) s = "bottom";
    else if (s === "bottom" && a.bottom + b.height + gap > vh - 4) s = "top";
    else if (s === "left" && a.left - b.width - gap < 4) s = "right";
    else if (s === "right" && a.right + b.width + gap > vw - 4) s = "left";
    let top: number;
    let left: number;
    if (s === "top" || s === "bottom") {
      top = s === "top" ? a.top - b.height - gap : a.bottom + gap;
      left = Math.min(vw - b.width - 6, Math.max(6, a.left + a.width / 2 - b.width / 2));
      setPos({ top, left, side: s, arrow: a.left + a.width / 2 - left });
    } else {
      left = s === "left" ? a.left - b.width - gap : a.right + gap;
      top = Math.min(vh - b.height - 6, Math.max(6, a.top + a.height / 2 - b.height / 2));
      setPos({ top, left, side: s, arrow: a.top + a.height / 2 - top });
    }
  }, [open, side, content, title]);

  const child = isValidElement(children) ? children : <span>{children}</span>;

  return (
    <>
      <span
        ref={anchor}
        className="inline-flex max-w-full"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {cloneElement(child)}
      </span>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={bubble}
            role="tooltip"
            onMouseEnter={interactive ? clear : undefined}
            onMouseLeave={interactive ? hide : undefined}
            className={`fixed z-[70] rounded-lg bg-ink px-3 py-2 text-left text-xs font-normal leading-relaxed text-white shadow-xl ${
              interactive ? "" : "pointer-events-none"
            }`}
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, maxWidth: width, visibility: pos ? "visible" : "hidden" }}
          >
            {title && <div className="mb-1 text-[12px] font-semibold">{title}</div>}
            <div className="text-white/85 [&_a]:font-medium [&_a]:text-white [&_a]:underline [&_b]:text-white [&_li]:mt-0.5">{content}</div>
            {pos && (
              <span
                className="absolute h-2 w-2 rotate-45 bg-ink"
                style={
                  pos.side === "top"
                    ? { bottom: -4, left: pos.arrow - 4 }
                    : pos.side === "bottom"
                      ? { top: -4, left: pos.arrow - 4 }
                      : pos.side === "left"
                        ? { right: -4, top: pos.arrow - 4 }
                        : { left: -4, top: pos.arrow - 4 }
                }
              />
            )}
          </div>,
          document.body
        )}
    </>
  );
}

/** 이름 옆 작은 ? 아이콘 */
export function Help({ title, content, interactive, side, width }: { title?: React.ReactNode; content: React.ReactNode; interactive?: boolean; side?: Side; width?: number }) {
  return (
    <Tip title={title} content={content} interactive={interactive} side={side} width={width}>
      <span
        tabIndex={0}
        className="ml-1 inline-grid h-3.5 w-3.5 cursor-help place-items-center rounded-full bg-slate-200 align-[1px] text-[9px] font-bold text-slate-500 hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
        aria-label="도움말"
      >
        ?
      </span>
    </Tip>
  );
}
