"use client";

// 업무 속성 라벨: 단계마다 여러 개 (기획·디자인·생산 등). 목록은 게임파트가 관리
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import type { StageLabel } from "@/lib/types";
import { useApp } from "./AppProvider";
import { Modal } from "./ui";

export const LABEL_COLORS = ["#6366f1", "#ec4899", "#0ea5e9", "#f59e0b", "#64748b", "#10b981", "#ef4444", "#8b5cf6", "#14b8a6", "#a16207"];

export function LabelChip({ label, onRemove, small }: { label: StageLabel; onRemove?: () => void; small?: boolean }) {
  const c = label.color ?? "#64748b";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${small ? "px-1.5 text-[10px]" : "px-2 py-0.5 text-xs"}`}
      style={{ background: `${c}1a`, color: c, boxShadow: `inset 0 0 0 1px ${c}40` }}
    >
      {label.name}
      {onRemove && (
        <button type="button" className="opacity-60 hover:opacity-100" onClick={onRemove} aria-label={`${label.name} 빼기`}>
          ✕
        </button>
      )}
    </span>
  );
}

/** 단계에 붙은 라벨 (id → 라벨) */
export function LabelList({ ids, small }: { ids: string[] | undefined; small?: boolean }) {
  const { labels } = useApp();
  if (!labels || !ids?.length) return null;
  const items = ids.map((id) => labels.find((l) => l.id === id)).filter(Boolean) as StageLabel[];
  return (
    <span className="inline-flex flex-wrap gap-1">
      {items.map((l) => (
        <LabelChip key={l.id} label={l} small={small} />
      ))}
    </span>
  );
}

export function LabelPicker({ value, onChange, disabled }: { value: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const { labels, me, reloadLabels } = useApp();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [manage, setManage] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  if (!labels) return null;
  const chosen = value.map((id) => labels.find((l) => l.id === id)).filter(Boolean) as StageLabel[];
  const shown = labels.filter((l) => !q.trim() || l.name.toLowerCase().includes(q.trim().toLowerCase()));
  const exact = labels.some((l) => l.name === q.trim());
  const canManage = !!me?.is_game_part;

  async function create() {
    const name = q.trim();
    if (!name) return;
    const { data, error } = await supabase()
      .from("stage_labels")
      .insert({ name, color: LABEL_COLORS[labels!.length % LABEL_COLORS.length], sort_order: labels!.length + 1 })
      .select()
      .single();
    if (error) return alert(error.message);
    await reloadLabels();
    onChange([...value, data.id]);
    setQ("");
  }

  return (
    <div className="relative" ref={box}>
      <div
        className={`flex min-h-[34px] flex-wrap items-center gap-1 rounded-lg border border-black/10 px-1.5 py-1 ${disabled ? "bg-slate-50" : "cursor-pointer bg-white hover:border-black/20"}`}
        onClick={() => !disabled && setOpen(true)}
      >
        {chosen.map((l) => (
          <LabelChip key={l.id} label={l} onRemove={disabled ? undefined : () => onChange(value.filter((x) => x !== l.id))} />
        ))}
        {chosen.length === 0 && <span className="px-1 text-sm text-slate-400">{disabled ? "없음" : "라벨 선택…"}</span>}
      </div>
      {open && (
        <div className="absolute left-0 z-40 mt-1 w-64 rounded-xl border border-black/10 bg-white shadow-xl">
          <div className="border-b border-black/[0.06] p-2">
            <input
              autoFocus
              className="input py-1 text-xs"
              placeholder={canManage ? "검색하거나 새 라벨 이름" : "라벨 검색"}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canManage && q.trim() && !exact && !shown.length) create();
                if (e.key === "Escape") setOpen(false);
              }}
            />
          </div>
          <ul className="scroll-thin max-h-60 overflow-y-auto py-1">
            {shown.map((l) => (
              <li key={l.id}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={value.includes(l.id)}
                    onChange={() => onChange(value.includes(l.id) ? value.filter((x) => x !== l.id) : [...value, l.id])}
                  />
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color ?? "#64748b" }} />
                  {l.name}
                </label>
              </li>
            ))}
            {canManage && q.trim() && !exact && (
              <li>
                <button className="w-full px-3 py-1.5 text-left text-sm text-brand-600 hover:bg-slate-50" onClick={create}>
                  + &lsquo;{q.trim()}&rsquo; 라벨 만들기
                </button>
              </li>
            )}
            {!shown.length && !canManage && <li className="px-3 py-3 text-center text-xs text-slate-400">없음</li>}
          </ul>
          {canManage && (
            <div className="border-t border-black/[0.06] px-3 py-1.5">
              <button
                className="text-xs text-slate-500 hover:text-ink"
                onClick={() => {
                  setManage(true);
                  setOpen(false);
                }}
              >
                라벨 관리 (이름·색·순서)…
              </button>
            </div>
          )}
        </div>
      )}
      <LabelManager open={manage} onClose={() => setManage(false)} />
    </div>
  );
}

export function LabelManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { labels, reloadLabels } = useApp();
  const [name, setName] = useState("");
  const list = labels ?? [];
  const sb = supabase();

  async function patch(id: string, p: Partial<StageLabel>) {
    const { error } = await sb.from("stage_labels").update(p).eq("id", id);
    if (error) alert(error.code === "23505" ? "같은 이름의 라벨이 있습니다" : error.message);
    reloadLabels();
  }
  async function add() {
    if (!name.trim()) return;
    const { error } = await sb
      .from("stage_labels")
      .insert({ name: name.trim(), color: LABEL_COLORS[list.length % LABEL_COLORS.length], sort_order: list.length + 1 });
    if (error) return alert(error.code === "23505" ? "같은 이름의 라벨이 있습니다" : error.message);
    setName("");
    reloadLabels();
  }
  async function move(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    await Promise.all(next.map((l, k) => (l.sort_order !== k + 1 ? sb.from("stage_labels").update({ sort_order: k + 1 }).eq("id", l.id) : null)));
    reloadLabels();
  }
  async function remove(l: StageLabel) {
    if (!confirm(`'${l.name}' 라벨을 지울까요? 모든 단계에서 빠집니다.`)) return;
    await sb.from("stage_labels").delete().eq("id", l.id);
    reloadLabels();
  }

  return (
    <Modal open={open} onClose={onClose} title="업무 속성 라벨 관리">
      <div className="space-y-3">
        <p className="text-xs text-slate-500">모든 프로젝트에서 같이 쓰는 목록입니다. 이름을 바꾸면 붙어 있는 단계에도 바로 반영됩니다.</p>
        <ul className="divide-y divide-black/[0.05] rounded-lg border border-black/10">
          {list.map((l, i) => (
            <li key={l.id} className="flex items-center gap-2 px-2.5 py-1.5">
              <label className="relative h-5 w-5 shrink-0 cursor-pointer rounded-full" style={{ background: l.color ?? "#64748b" }} title="색 바꾸기">
                <select
                  className="absolute inset-0 cursor-pointer opacity-0"
                  value={l.color ?? ""}
                  onChange={(e) => patch(l.id, { color: e.target.value })}
                >
                  {LABEL_COLORS.map((c) => (
                    <option key={c} value={c} style={{ color: c }}>
                      ● {c}
                    </option>
                  ))}
                </select>
              </label>
              <input
                className="min-w-0 flex-1 rounded border border-transparent px-1.5 py-0.5 text-sm hover:border-black/10 focus:border-brand-500 focus:outline-none"
                defaultValue={l.name}
                onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== l.name && patch(l.id, { name: e.target.value.trim() })}
              />
              <button className="btn-ghost px-1.5 py-0.5 text-xs" disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button className="btn-ghost px-1.5 py-0.5 text-xs" disabled={i === list.length - 1} onClick={() => move(i, 1)}>
                ↓
              </button>
              <button className="btn-danger px-1.5 py-0.5 text-xs" onClick={() => remove(l)}>
                삭제
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="px-3 py-4 text-center text-xs text-slate-400">라벨이 없습니다</li>}
        </ul>
        <div className="flex gap-2">
          <input className="input" placeholder="새 라벨 이름" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <button className="btn-primary shrink-0" disabled={!name.trim()} onClick={add}>
            추가
          </button>
        </div>
      </div>
    </Modal>
  );
}
