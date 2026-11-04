"use client";

// 단계 상세 패널의 부속: 체크리스트, 파일·링크, 선후 관계, 지라·컨플루언스 참조
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { linkInfo, linkTitle } from "@/lib/links";
import { predsOf, succsOf, wouldCycle } from "@/lib/deps";
import { relativeTime, short } from "@/lib/dates";
import type { Profile, Stage, StageCheck, StageDep, StageLink, StageLog } from "@/lib/types";
import { displayName } from "./AppProvider";

function Head({ title, right, hint }: { title: React.ReactNode; right?: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-center gap-2">
      <h3 className="text-xs font-semibold text-slate-700">{title}</h3>
      {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
      <span className="ml-auto">{right}</span>
    </div>
  );
}

// ---------------------------------------------------------------------
// 체크리스트
// ---------------------------------------------------------------------
export function StageChecklist({
  projectId,
  stageId,
  items: initial,
  canEdit,
  myId,
  profileById,
  onChanged,
}: {
  projectId: string;
  stageId: string;
  items: StageCheck[];
  canEdit: boolean;
  myId: string;
  profileById: Record<string, Profile>;
  onChanged: () => void;
}) {
  const [items, setItems] = useState(initial);
  const [text, setText] = useState("");
  const [hideDone, setHideDone] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => setItems(initial), [initial]);
  const sb = supabase();
  const done = items.filter((i) => i.done).length;

  async function add() {
    const lines = text
      .split("\n")
      .map((l) => l.replace(/^\s*([-*•☐□]|\[\s?\])\s*/, "").trim())
      .filter(Boolean);
    if (!lines.length) return;
    const base = items.reduce((m, i) => Math.max(m, i.sort_order), -1) + 1;
    setText("");
    const { error } = await sb
      .from("stage_checks")
      .insert(lines.map((body, k) => ({ project_id: projectId, stage_id: stageId, body, sort_order: base + k })));
    if (error) alert(error.message);
    onChanged();
  }
  async function toggle(c: StageCheck) {
    const next = !c.done;
    setItems((xs) => xs.map((x) => (x.id === c.id ? { ...x, done: next, done_by: next ? myId : null, done_at: next ? new Date().toISOString() : null } : x)));
    await sb
      .from("stage_checks")
      .update({ done: next, done_by: next ? myId : null, done_at: next ? new Date().toISOString() : null })
      .eq("id", c.id);
    onChanged();
  }
  async function rename(c: StageCheck, body: string) {
    setEditing(null);
    if (!body.trim() || body.trim() === c.body) return;
    setItems((xs) => xs.map((x) => (x.id === c.id ? { ...x, body: body.trim() } : x)));
    await sb.from("stage_checks").update({ body: body.trim() }).eq("id", c.id);
    onChanged();
  }
  async function remove(c: StageCheck) {
    setItems((xs) => xs.filter((x) => x.id !== c.id));
    await sb.from("stage_checks").delete().eq("id", c.id);
    onChanged();
  }
  async function move(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
    await Promise.all(next.map((c, k) => (c.sort_order !== k ? sb.from("stage_checks").update({ sort_order: k }).eq("id", c.id) : null)));
    onChanged();
  }

  const shown = hideDone ? items.filter((i) => !i.done) : items;

  return (
    <section className="space-y-2" data-tour="sp-checklist">
      <Head
        title={
          <>
            체크리스트{" "}
            {items.length > 0 && (
              <span className={`ml-1 font-normal tabular-nums ${done === items.length ? "text-emerald-600" : "text-slate-400"}`}>
                {done}/{items.length}
              </span>
            )}
          </>
        }
        right={
          done > 0 && (
            <button className="text-[11px] text-slate-400 hover:text-ink" onClick={() => setHideDone((v) => !v)}>
              {hideDone ? "완료 항목 보기" : "완료 항목 숨기기"}
            </button>
          )
        }
      />
      {items.length > 0 && (
        <div className="h-1 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(done / items.length) * 100}%` }} />
        </div>
      )}
      <ul className="space-y-0.5">
        {shown.map((c) => {
          const i = items.indexOf(c);
          return (
            <li key={c.id} className="group flex items-start gap-2 rounded-md px-1 py-1 hover:bg-slate-50">
              <input type="checkbox" className="mt-[3px] h-3.5 w-3.5 accent-[var(--color-brand-500)]" disabled={!canEdit} checked={c.done} onChange={() => toggle(c)} />
              {editing === c.id ? (
                <input
                  autoFocus
                  className="input flex-1 py-0.5 text-sm"
                  defaultValue={c.body}
                  onBlur={(e) => rename(c, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <span
                  className={`min-w-0 flex-1 text-sm ${c.done ? "text-slate-400 line-through" : ""} ${canEdit ? "cursor-text" : ""}`}
                  onDoubleClick={() => canEdit && setEditing(c.id)}
                  title={c.done && c.done_by ? `${displayName(profileById[c.done_by])} · ${c.done_at ? relativeTime(c.done_at) : ""} 완료` : canEdit ? "두 번 눌러 고치기" : undefined}
                >
                  {c.body}
                </span>
              )}
              {canEdit && editing !== c.id && (
                <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                  <button className="px-1 text-[11px] text-slate-400 hover:text-ink" disabled={i === 0} onClick={() => move(i, -1)} title="위로">
                    ↑
                  </button>
                  <button className="px-1 text-[11px] text-slate-400 hover:text-ink" disabled={i === items.length - 1} onClick={() => move(i, 1)} title="아래로">
                    ↓
                  </button>
                  <button className="px-1 text-[11px] text-slate-400 hover:text-ink" onClick={() => setEditing(c.id)} title="고치기">
                    ✎
                  </button>
                  <button className="px-1 text-[11px] text-rose-400 hover:text-rose-600" onClick={() => remove(c)} title="삭제">
                    ✕
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {canEdit && (
        <div className="flex gap-1.5">
          <textarea
            rows={1}
            className="input min-h-[32px] resize-none py-1 text-sm"
            placeholder="할 일 추가 (Enter) · 여러 줄 붙여넣으면 한 번에"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                add();
              }
            }}
          />
          <button className="btn-outline shrink-0 px-2.5 py-1 text-xs" disabled={!text.trim()} onClick={add}>
            추가
          </button>
        </div>
      )}
      {!canEdit && items.length === 0 && <p className="text-xs text-slate-400">없음</p>}
    </section>
  );
}

// ---------------------------------------------------------------------
// 파일·링크 (구글 드라이브 미리보기)
// ---------------------------------------------------------------------
export function StageLinks({
  projectId,
  stageId,
  items,
  canEdit,
  onChanged,
  onPreview,
}: {
  projectId: string;
  stageId: string;
  items: StageLink[];
  canEdit: boolean;
  onChanged: () => void;
  onPreview: (l: { url: string; title: string; preview: string }) => void;
}) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const sb = supabase();

  async function add() {
    const u = url.trim();
    if (!/^https?:\/\//i.test(u)) return alert("https:// 로 시작하는 주소를 붙여넣어 주세요");
    const base = items.reduce((m, i) => Math.max(m, i.sort_order), -1) + 1;
    const { error } = await sb.from("stage_links").insert({ project_id: projectId, stage_id: stageId, url: u, title: title.trim() || null, sort_order: base });
    if (error) return alert(error.message);
    setUrl("");
    setTitle("");
    setAdding(false);
    onChanged();
  }
  async function rename(l: StageLink) {
    const t = prompt("이름", linkTitle(l.url, l.title));
    if (t === null) return;
    await sb.from("stage_links").update({ title: t.trim() || null }).eq("id", l.id);
    onChanged();
  }
  async function remove(l: StageLink) {
    if (!confirm(`'${linkTitle(l.url, l.title)}' 연결을 뺄까요? (파일 자체는 지워지지 않습니다)`)) return;
    await sb.from("stage_links").delete().eq("id", l.id);
    onChanged();
  }

  const info = url.trim() ? linkInfo(url) : null;

  return (
    <section className="space-y-2" data-tour="sp-links">
      <Head
        title={
          <>
            파일·링크 {items.length > 0 && <span className="ml-1 font-normal text-slate-400">{items.length}</span>}
          </>
        }
        right={
          canEdit &&
          !adding && (
            <button className="text-[11px] text-brand-600 hover:underline" onClick={() => setAdding(true)}>
              + 연결
            </button>
          )
        }
      />
      <ul className="space-y-1">
        {items.map((l) => {
          const li = linkInfo(l.url);
          const name = linkTitle(l.url, l.title);
          return (
            <li key={l.id} className="group flex items-center gap-2 rounded-lg border border-black/[0.07] px-2 py-1.5 hover:bg-slate-50">
              <span className="text-base leading-none">{li.icon}</span>
              <span className="min-w-0 flex-1">
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="block truncate text-sm hover:underline" title={l.url}>
                  {name}
                </a>
                <span className="block text-[10px] text-slate-400">{li.label}</span>
              </span>
              {li.preview && (
                <button className="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-200" onClick={() => onPreview({ url: l.url, title: name, preview: li.preview! })}>
                  보기
                </button>
              )}
              {canEdit && (
                <span className="hidden shrink-0 gap-0.5 group-hover:flex">
                  <button className="px-1 text-[11px] text-slate-400 hover:text-ink" onClick={() => rename(l)} title="이름 바꾸기">
                    ✎
                  </button>
                  <button className="px-1 text-[11px] text-rose-400 hover:text-rose-600" onClick={() => remove(l)} title="연결 빼기">
                    ✕
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {items.length === 0 && !adding && <p className="text-xs text-slate-400">{canEdit ? "구글 드라이브 파일·문서·시트 주소를 붙여넣으면 여기서 바로 볼 수 있어요." : "없음"}</p>}
      {adding && (
        <div className="space-y-1.5 rounded-lg bg-slate-50 p-2">
          <input
            autoFocus
            className="input text-xs"
            placeholder="주소 붙여넣기 (구글 드라이브·문서·시트·슬라이드·Figma 등)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <input className="input text-xs" placeholder={info ? `이름 (비우면 '${info.label}')` : "이름 (선택)"} value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          {info && (
            <p className="text-[11px] text-slate-500">
              {info.icon} {info.label}
              {info.preview ? " · 패널에서 바로 보기 가능" : " · 새 창으로 열림"}
            </p>
          )}
          <div className="flex justify-end gap-1">
            <button className="btn-ghost py-1 text-xs" onClick={() => setAdding(false)}>
              취소
            </button>
            <button className="btn-primary py-1 text-xs" disabled={!url.trim()} onClick={add}>
              연결
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------
// 선후 관계
// ---------------------------------------------------------------------
export function StageDeps({
  stage,
  stages,
  deps,
  canEdit,
  onChanged,
  onOpen,
}: {
  stage: Stage;
  stages: Stage[];
  deps: StageDep[];
  canEdit: boolean;
  onChanged: () => void;
  onOpen: (id: string) => void;
}) {
  const [pick, setPick] = useState("");
  const [dir, setDir] = useState<"pred" | "succ">("pred");
  const sb = supabase();
  const byId = new Map(stages.map((s) => [s.id, s]));
  const preds = predsOf(stage.id, deps).map((id) => byId.get(id)).filter(Boolean) as Stage[];
  const succs = succsOf(stage.id, deps).map((id) => byId.get(id)).filter(Boolean) as Stage[];
  const linked = new Set([stage.id, ...preds.map((s) => s.id), ...succs.map((s) => s.id)]);
  const candidates = stages.filter((s) => !linked.has(s.id));

  async function add() {
    if (!pick) return;
    const pred = dir === "pred" ? pick : stage.id;
    const succ = dir === "pred" ? stage.id : pick;
    if (wouldCycle(deps, pred, succ)) return alert("서로 순서가 꼬이게 됩니다 (이미 반대 방향으로 연결돼 있어요).");
    const { error } = await sb.from("stage_deps").insert({ project_id: stage.project_id, pred_id: pred, succ_id: succ });
    if (error) return alert(error.message);
    setPick("");
    onChanged();
  }
  async function remove(pred: string, succ: string) {
    await sb.from("stage_deps").delete().eq("pred_id", pred).eq("succ_id", succ);
    onChanged();
  }

  const Item = ({ s, pred, succ }: { s: Stage; pred: string; succ: string }) => {
    const gap = (() => {
      const a = byId.get(pred);
      const b = byId.get(succ);
      const ae = a?.actual_end ?? a?.expected_end ?? a?.plan_end;
      if (!ae || !b?.plan_start) return null;
      return ae >= b.plan_start;
    })();
    return (
      <li className="group flex items-center gap-2 text-sm">
        <button className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => onOpen(s.id)}>
          {s.name}
        </button>
        <span className="shrink-0 text-[11px] tabular-nums text-slate-400">
          {s.plan_start ? `${short(s.plan_start)}~${short(s.plan_end)}` : "일정 없음"}
        </span>
        {gap && (
          <span className="shrink-0 rounded bg-rose-50 px-1 text-[10px] text-rose-600" title="앞 단계가 끝나기 전에 시작하도록 잡혀 있어요">
            겹침
          </span>
        )}
        {canEdit && (
          <button className="hidden shrink-0 px-1 text-[11px] text-rose-400 hover:text-rose-600 group-hover:inline" onClick={() => remove(pred, succ)} title="연결 끊기">
            ✕
          </button>
        )}
      </li>
    );
  };

  return (
    <section className="space-y-2" data-tour="sp-deps">
      <Head title="연관 업무 (선후 관계)" hint="앞 단계가 늦어지면 뒤 단계도 함께 미룰지 물어봐요" />
      <div className="grid gap-2 text-xs">
        <div>
          <div className="mb-1 text-[11px] font-medium text-slate-500">⬅ 앞 단계 (먼저 끝나야 함)</div>
          {preds.length ? (
            <ul className="space-y-1">
              {preds.map((s) => (
                <Item key={s.id} s={s} pred={s.id} succ={stage.id} />
              ))}
            </ul>
          ) : (
            <p className="text-slate-400">없음</p>
          )}
        </div>
        <div>
          <div className="mb-1 text-[11px] font-medium text-slate-500">뒤 단계 (이 단계 다음) ➡</div>
          {succs.length ? (
            <ul className="space-y-1">
              {succs.map((s) => (
                <Item key={s.id} s={s} pred={stage.id} succ={s.id} />
              ))}
            </ul>
          ) : (
            <p className="text-slate-400">없음</p>
          )}
        </div>
      </div>
      {canEdit && candidates.length > 0 && (
        <div className="flex gap-1.5">
          <select className="rounded-lg border border-black/10 bg-white px-1.5 py-1 text-xs" value={dir} onChange={(e) => setDir(e.target.value as "pred" | "succ")}>
            <option value="pred">앞 단계로</option>
            <option value="succ">뒤 단계로</option>
          </select>
          <select className="input min-w-0 py-1 text-xs" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">단계 선택…</option>
            {candidates.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.plan_start ? ` (${short(s.plan_start)}~)` : ""}
              </option>
            ))}
          </select>
          <button className="btn-outline shrink-0 px-2.5 py-1 text-xs" disabled={!pick} onClick={add}>
            연결
          </button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------
// 지라·컨플루언스에서 이 단계를 언급한 곳
// ---------------------------------------------------------------------
export function StageExternal({ logs }: { logs: StageLog[] }) {
  const refs = logs.filter((l) => l.source && l.ext_url && !l.ext_key?.includes("#"));
  if (!refs.length) return null;
  return (
    <section className="space-y-2" data-tour="sp-external">
      <Head title="지라·컨플루언스에서 언급" hint={`${refs.length}건`} />
      <ul className="space-y-1">
        {refs.map((l) => (
          <li key={l.id} className="flex items-center gap-2 rounded-lg border border-black/[0.07] px-2 py-1.5 text-sm">
            <span>{l.source === "jira" ? "🟦" : "📘"}</span>
            <a href={l.ext_url!} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate hover:underline" title={l.body}>
              {l.ext_title ?? l.body}
            </a>
            {l.ext_status && <span className="shrink-0 rounded bg-slate-100 px-1.5 text-[11px] text-slate-600">{l.ext_status}</span>}
            <span className="shrink-0 text-[10px] text-slate-400">{relativeTime(l.edited_at ?? l.created_at)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
