"use client";

import { useEffect, useRef, useState } from "react";

export interface ProjectOption {
  id: string;
  name: string;
  category: string | null;
  count: number;
}

/** 프로젝트 여러 개 고르기. 아무것도 안 고르면 '전체' */
export function ProjectFilter({
  options,
  value,
  onChange,
  emptyLabel = "전체",
  title = "프로젝트",
  showCount = true,
}: {
  options: ProjectOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  /** 아무것도 안 골랐을 때 보이는 글자 */
  emptyLabel?: string;
  title?: string;
  showCount?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const shown = options.filter((o) => !q.trim() || `${o.name} ${o.category ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const label =
    value.length === 0
      ? emptyLabel
      : value.length === 1
        ? options.find((o) => o.id === value[0])?.name ?? "1개 선택"
        : `${value.length}개 선택`;

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex max-w-[260px] items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs ${
          value.length ? "border-brand-500/40 bg-brand-50 text-brand-700" : "border-black/10 bg-white text-slate-700"
        }`}
      >
        <span className="text-slate-400">{title}</span>
        <span className="truncate font-medium">{label}</span>
        <span className="text-slate-400">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 z-30 mt-1 w-80 rounded-xl border border-black/10 bg-white shadow-xl">
          <div className="border-b border-black/[0.06] p-2">
            <input autoFocus className="input py-1 text-xs" placeholder="프로젝트 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="flex items-center justify-between px-3 py-1.5 text-[11px] text-slate-500">
            <span>여러 개 선택할 수 있어요</span>
            <div className="flex gap-2">
              <button className="hover:text-ink" onClick={() => onChange(shown.map((o) => o.id))}>
                모두 선택
              </button>
              <button className="hover:text-ink" onClick={() => onChange([])}>
                선택 해제{emptyLabel === "전체" ? " (전체 보기)" : ""}
              </button>
            </div>
          </div>
          <ul className="scroll-thin max-h-72 overflow-y-auto pb-1">
            {shown.length === 0 && <li className="px-3 py-4 text-center text-xs text-slate-400">해당하는 프로젝트가 없습니다</li>}
            {shown.map((o) => (
              <li key={o.id}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50">
                  <input type="checkbox" checked={value.includes(o.id)} onChange={() => toggle(o.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{o.name}</span>
                    {o.category && <span className="block truncate text-[11px] text-slate-400">{o.category}</span>}
                  </span>
                  {showCount && (
                    <span className={`shrink-0 text-xs tabular-nums ${o.count ? "text-slate-500" : "text-slate-300"}`}>{o.count}단계</span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
