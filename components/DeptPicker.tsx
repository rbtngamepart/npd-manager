"use client";

import type { DeptColorFn } from "@/lib/deptColors";

/** 연관부서 여러 개 고르기: 관리자가 정한 부서 목록에서 선택 */
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
  const suggestions = options.filter((o) => o !== exclude && !value.includes(o));

  return (
    <div className="space-y-1.5">
      <div className={`flex min-h-[34px] flex-wrap items-center gap-1 rounded-lg border border-black/10 px-1.5 py-1 ${disabled ? "bg-slate-50" : "bg-white"}`}>
        {value.map((d) => {
          const unlisted = !options.includes(d);
          return (
            <span
              key={d}
              title={unlisted ? "부서 목록에 없는 이름입니다 (관리자 > 부서에서 정리)" : undefined}
              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs ring-1 ring-inset ${
                unlisted ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-violet-50 text-violet-700 ring-violet-200"
              }`}
            >
              {d}
              {!disabled && (
                <button type="button" className="opacity-60 hover:opacity-100" onClick={() => onChange(value.filter((x) => x !== d))} aria-label={`${d} 빼기`}>
                  ✕
                </button>
              )}
            </span>
          );
        })}
        {value.length === 0 && <span className="px-1 text-sm text-slate-400">{disabled ? "없음" : "아래에서 부서를 눌러 추가"}</span>}
      </div>
      {!disabled && suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {suggestions.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onChange([...value, d])}
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

/** 담당부서 하나 고르기 (목록에 없는 기존 값도 그대로 보여줌) */
export function DeptSelect({
  value,
  onChange,
  options,
  disabled,
  placeholder = "선택",
  className = "input",
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  options: string[];
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const unlisted = value && !options.includes(value);
  return (
    <select className={className} disabled={disabled} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{placeholder}</option>
      {options.map((d) => (
        <option key={d} value={d}>
          {d}
        </option>
      ))}
      {unlisted && <option value={value!}>{value} (목록에 없음)</option>}
    </select>
  );
}

/** 담당부서 + 연관부서 작게 표시 */
export function DeptBadges({
  owner,
  related,
  highlight,
  colorOf,
}: {
  owner: string | null;
  related: string[];
  highlight?: string | null;
  colorOf?: DeptColorFn;
}) {
  const oc = colorOf && owner ? colorOf(owner) : null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {oc ? (
        <span
          className={`rounded px-1.5 py-px text-[11px] font-medium ${highlight === owner ? "ring-2 ring-offset-1" : ""}`}
          style={{ background: oc.light, color: oc.text, ["--tw-ring-color" as string]: oc.solid }}
        >
          {owner}
        </span>
      ) : (
        <span className={highlight && highlight === owner ? "font-semibold text-ink" : ""}>{owner ?? "—"}</span>
      )}
      {(related ?? []).map((d) => {
        const c = colorOf ? colorOf(d) : null;
        return c ? (
          <span
            key={d}
            className={`inline-flex items-center gap-1 rounded px-1 text-[11px] ${highlight === d ? "font-semibold" : ""}`}
            style={{ color: c.text, boxShadow: `inset 0 0 0 1px ${c.solid}55` }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.solid }} />+{d}
          </span>
        ) : (
          <span
            key={d}
            className={`rounded px-1 text-[11px] ring-1 ring-inset ${
              highlight === d ? "bg-violet-100 text-violet-800 ring-violet-300" : "bg-violet-50 text-violet-600 ring-violet-200"
            }`}
          >
            +{d}
          </span>
        );
      })}
    </span>
  );
}
