"use client";

import { STATUS_META, type AutoStatus } from "@/lib/status";
import type { Light } from "@/lib/types";

export function StatusChip({ status, size = "md" }: { status: AutoStatus; size?: "sm" | "md" }) {
  if (!status) return <span className="text-xs text-slate-300">—</span>;
  const m = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full ring-1 ring-inset ${m.chip} ${
        size === "sm" ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-0.5 text-xs"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}

export function StatusDot({ status }: { status: AutoStatus }) {
  if (!status) return <span className="inline-block h-2 w-2 rounded-full bg-slate-200" />;
  return <span className={`inline-block h-2 w-2 rounded-full ${STATUS_META[status].dot}`} title={STATUS_META[status].label} />;
}

const LIGHTS: { v: Light | null; label: string }[] = [
  { v: null, label: "자동" },
  { v: "green", label: "정상" },
  { v: "yellow", label: "주의" },
  { v: "red", label: "차질" },
];

/** PM 판단 선택 (자동 / 🟢 / 🟡 / 🔴) */
export function PmPicker({
  value,
  onChange,
  disabled,
}: {
  value: Light | null;
  onChange: (v: Light | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex rounded-lg border border-black/10 bg-white p-0.5">
      {LIGHTS.map((l) => {
        const active = value === l.v;
        const dot = l.v ? STATUS_META[l.v].dot : "bg-slate-300";
        return (
          <button
            key={l.label}
            type="button"
            disabled={disabled}
            onClick={() => onChange(l.v)}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition disabled:cursor-not-allowed ${
              active ? "bg-ink text-white" : "text-slate-600 hover:bg-black/5"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${l.v ? dot : active ? "bg-white/60" : "bg-slate-300"}`} />
            {l.label}
          </button>
        );
      })}
    </div>
  );
}

export function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-ink" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
      <span className="w-9 text-right text-xs tabular-nums text-slate-500">{value}%</span>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  width = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-[8vh]" onMouseDown={onClose}>
      <div className={`card w-full ${width} shadow-xl`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-black/[0.06] px-5 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button className="btn-ghost -mr-2 px-2" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-black/10 p-10 text-center text-sm text-slate-500">{children}</div>;
}

export function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-lg bg-ink px-4 py-2 text-sm text-white shadow-lg">
      {msg}
    </div>
  );
}
