"use client";

// 오른쪽 클릭 메뉴 (사이트 공통). Shift+오른쪽 클릭은 브라우저 기본 메뉴.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type CtxItem =
  | { label: string; icon?: string; hint?: string; danger?: boolean; disabled?: boolean; checked?: boolean; run?: () => void; children?: CtxItem[] }
  | { header: string }
  | "sep";

type Open = (e: React.MouseEvent | MouseEvent, items: (CtxItem | false | null | undefined)[]) => void;
const Ctx = createContext<Open>(() => {});

/** 메뉴 열기: onContextMenu={(e) => openMenu(e, [...])} */
export function useContextMenu(): Open {
  return useContext(Ctx);
}

const isAction = (x: CtxItem): x is Extract<CtxItem, { label: string }> => typeof x === "object" && "label" in x;

export function ContextMenuProvider({ children }: { children: React.ReactNode }) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: CtxItem[] } | null>(null);
  const open = useCallback<Open>((e, items) => {
    if (e.shiftKey) return; // 브라우저 기본 메뉴
    const list = items.filter(Boolean) as CtxItem[];
    // 앞뒤·연속 구분선 정리
    const clean = list.filter((x, i, a) => x !== "sep" || (i > 0 && i < a.length - 1 && a[i - 1] !== "sep"));
    if (!clean.some(isAction)) return;
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items: clean });
  }, []);
  return (
    <Ctx.Provider value={open}>
      {children}
      {menu && <MenuBox x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} root />}
    </Ctx.Provider>
  );
}

function MenuBox({ x, y, items, onClose, root, parentWidth = 0 }: { x: number; y: number; items: CtxItem[]; onClose: () => void; root?: boolean; parentWidth?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y, ready: false });
  const [i, setI] = useState(-1);
  const [sub, setSub] = useState<{ idx: number; x: number; y: number; w: number } | null>(null);
  const actions = items.map((it, idx) => (isAction(it) && !it.disabled ? idx : -1)).filter((n) => n >= 0);

  // 화면 밖으로 나가지 않게
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + r.width > window.innerWidth - 8) left = root ? Math.max(8, x - r.width) : Math.max(8, x - r.width - parentWidth);
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - r.height - 8);
    setPos({ left, top, ready: true });
  }, [x, y, root, parentWidth]);

  useEffect(() => {
    if (!root) return;
    const close = () => onClose();
    const off = (e: MouseEvent) => !(e.target as Element)?.closest?.(".npd-ctx") && onClose();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", off, true);
    document.addEventListener("contextmenu", off, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", off, true);
      document.removeEventListener("contextmenu", off, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [root, onClose]);

  // 방향키로 고르기 (맨 위 메뉴만, 하위 메뉴가 열려 있지 않을 때)
  useEffect(() => {
    if (!root || sub) return;
    const key = (e: KeyboardEvent) => {
      if (!actions.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const cur = actions.indexOf(i);
        const nx = e.key === "ArrowDown" ? actions[(cur + 1) % actions.length] : actions[(cur - 1 + actions.length) % actions.length];
        setI(nx);
      } else if (e.key === "Enter" && i >= 0) {
        e.preventDefault();
        pick(i);
      } else if (e.key === "ArrowRight" && i >= 0) {
        const it = items[i];
        if (isAction(it) && it.children) openSub(i);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  function openSub(idx: number) {
    const btn = ref.current?.querySelector<HTMLElement>(`[data-i="${idx}"]`);
    const r = btn?.getBoundingClientRect();
    const w = ref.current?.getBoundingClientRect().width ?? 0;
    if (r) setSub({ idx, x: r.right + 2, y: r.top - 4, w });
  }
  function pick(idx: number) {
    const it = items[idx];
    if (!isAction(it) || it.disabled) return;
    if (it.children) return openSub(idx);
    onClose();
    it.run?.();
  }

  const box = (
    <div
      ref={ref}
      className="npd-ctx fixed z-[95] min-w-[200px] max-w-[300px] rounded-lg border border-black/10 bg-white p-1 text-[13px] shadow-xl"
      style={{ left: pos.left, top: pos.top, visibility: pos.ready ? "visible" : "hidden" }}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, idx) => {
        if (it === "sep") return <div key={`s${idx}`} className="my-1 border-t border-black/[0.07]" />;
        if (!isAction(it))
          return (
            <div key={`h${idx}`} className="truncate px-2.5 pb-0.5 pt-1.5 text-[11px] text-slate-400">
              {it.header}
            </div>
          );
        return (
          <button
            key={`${idx}-${it.label}`}
            data-i={idx}
            role="menuitem"
            disabled={it.disabled}
            className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left disabled:opacity-40 ${idx === i || sub?.idx === idx ? (it.danger ? "bg-rose-50" : "bg-slate-100") : ""} ${it.danger ? "text-rose-600" : "text-slate-700"}`}
            onMouseEnter={() => {
              setI(idx);
              if (it.children) openSub(idx);
              else setSub(null);
            }}
            onClick={() => pick(idx)}
          >
            <span className="w-4 shrink-0 text-center text-xs">{it.checked ? "✓" : it.icon ?? ""}</span>
            <span className="min-w-0 flex-1 truncate">{it.label}</span>
            {it.hint && <span className="shrink-0 text-[11px] text-slate-400">{it.hint}</span>}
            {it.children && <span className="shrink-0 text-[10px] text-slate-400">▶</span>}
          </button>
        );
      })}
      {sub && (() => {
        const it = items[sub.idx];
        return isAction(it) && it.children ? <MenuBox x={sub.x} y={sub.y} items={it.children} onClose={onClose} parentWidth={sub.w} /> : null;
      })()}
    </div>
  );
  return root ? createPortal(box, document.body) : box;
}

/** 링크·글자 복사 도우미 */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
