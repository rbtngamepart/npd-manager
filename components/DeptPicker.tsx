"use client";

import { useState } from "react";

/** 연관부서 여러 개 고르기: 추천 칩을 누르거나 직접 입력 후 Enter */
export function DeptPicker({
  value,
  onChange,
  options,
  exclude,
  disabled,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  options: string[];
  exclude?: string | null;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const add = (d: string) => {
    const t = d.trim();
    if (!t || t === exclude || value.includes(t)) return;
    onChange([...value, t]);
    setText("");
  };
  const suggestions = options.filter((o) => o !== exclude && !value.includes(o));

  return (
    <div className="space-y-1.5">
      <div className={`flex min-h-[34px] flex-wrap items-center gap-1 rounded-lg border border-black/10 px-1.5 py-1 ${disabled ? "bg-slate-50" : "bg-white"}`}>
        {value.map((d) => (
          <span key={d} className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-1.5 py-0.5 text-xs text-violet-700 ring-1 ring-inset ring-violet-200">
            {d}
            {!disabled && (
              <button type="button" className="text-violet-400 hover:text-violet-700" onClick={() => onChange(value.filter((x) => x !== d))} aria-label={`${d} 빼기`}>
                ✕
              </button>
            )}
          </span>
        ))}
        {!disabled && (
          <input
            className="min-w-[90px] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-slate-400"
            placeholder={value.length ? "" : "부서 입력 후 Enter"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                add(text);
              }
              if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
            }}
            onBlur={() => text && add(text)}
          />
        )}
        {disabled && value.length === 0 && <span className="px-1 text-sm text-slate-400">없음</span>}
      </div>
      {!disabled && suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {suggestions.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => add(d)}
              className="rounded-md border border-dashed border-black/15 px-1.5 py-0.5 text-[11px] text-slate-500 hover:border-violet-400 hover:text-violet-700"
            >
              + {d}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 담당부서 + 연관부서 작게 표시 */
export function DeptBadges({ owner, related, highlight }: { owner: string | null; related: string[]; highlight?: string | null }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={highlight && highlight === owner ? "font-semibold text-ink" : ""}>{owner ?? "—"}</span>
      {(related ?? []).map((d) => (
        <span
          key={d}
          className={`rounded px-1 text-[11px] ring-1 ring-inset ${
            highlight === d ? "bg-violet-100 text-violet-800 ring-violet-300" : "bg-violet-50 text-violet-600 ring-violet-200"
          }`}
        >
          +{d}
        </span>
      ))}
    </span>
  );
}
