"use client";

// 메모: 회의록·아이디어·자유 메모 (문서 / 마인드맵), 필요하면 프로젝트·단계에 연결
import dynamic from "next/dynamic";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { displayName, useApp } from "@/components/AppProvider";
import { RichEditor, htmlToText, isEmptyHtml } from "@/components/RichText";
import { mindmapText, withRootTitle, type MindMapHandle } from "@/components/MindMap";
import { Help, Tip } from "@/components/Tip";
import { useUnsaved } from "@/lib/unsaved";
import { relativeTime, today as todayFn } from "@/lib/dates";
import type { Note, NoteCategory, NoteKind, Project, Stage } from "@/lib/types";

const MindMap = dynamic(() => import("@/components/MindMap").then((m) => m.MindMap), {
  ssr: false,
  loading: () => <p className="p-10 text-center text-sm text-slate-400">마인드맵 불러오는 중…</p>,
});

const CAT: Record<NoteCategory, { label: string; cls: string; icon: string }> = {
  meeting: { label: "회의", cls: "bg-violet-50 text-violet-700", icon: "👥" },
  idea: { label: "아이디어", cls: "bg-amber-50 text-amber-700", icon: "💡" },
  memo: { label: "메모", cls: "bg-slate-100 text-slate-600", icon: "📝" },
};
const KIND_ICON: Record<NoteKind, string> = { doc: "📄", mindmap: "🧠" };
const LIST_COLS = "id,title,kind,category,note_date,body_text,project_id,stage_ids,visibility,author_id,updated_by,created_at,updated_at";

const MEETING_TEMPLATE =
  "<p><strong>참석자</strong></p><p></p><p><strong>안건</strong></p><ol><li><p></p></li></ol><p><strong>논의 내용</strong></p><ul><li><p></p></li></ul><p><strong>결정 사항</strong></p><ul><li><p></p></li></ul><p><strong>할 일</strong></p><ul data-type=\"taskList\"><li data-type=\"taskItem\" data-checked=\"false\"><label><input type=\"checkbox\"><span></span></label><div><p></p></div></li></ul>";

type StageLite = Pick<Stage, "id" | "project_id" | "name" | "parent_id" | "sort_order">;
type ProjectLite = Pick<Project, "id" | "name" | "archived">;
type SaveState = "idle" | "saving" | "saved" | "error";

export default function NotesPage() {
  return (
    <Suspense fallback={<p className="py-20 text-center text-sm text-slate-400">불러오는 중…</p>}>
      <Notes />
    </Suspense>
  );
}

function Notes() {
  const { me, profileById } = useApp();
  const router = useRouter();
  const params = useSearchParams();
  const path = usePathname();
  const selectedId = params.get("id");

  const [notes, setNotes] = useState<Note[]>([]);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<ProjectLite[]>([]);
  const [stages, setStages] = useState<StageLite[]>([]);

  // 목록 필터
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<NoteCategory | "all">("all");
  const [scope, setScope] = useState<"all" | "mine" | "private">("all");
  const [proj, setProj] = useState<string>("all");
  const [hideList, setHideList] = useState(false);

  // 열린 메모
  const [draft, setDraft] = useState<Note | null>(null);
  const [rk, setRk] = useState(0); // 편집기 다시 채우기
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [conflict, setConflict] = useState<Note | null>(null);
  const base = useRef<string | null>(null); // 불러온 때의 updated_at
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<boolean> | null>(null);
  const mapRef = useRef<MindMapHandle>(null);

  // ---- 불러오기 ----------------------------------------------------------
  const loadList = useCallback(async () => {
    const { data, error } = await supabase().from("notes").select(LIST_COLS).order("note_date", { ascending: false }).order("updated_at", { ascending: false });
    if (error) {
      if (/notes|relation|schema cache/i.test(error.message)) setMissing(true);
    } else setNotes((data ?? []) as Note[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadList();
    (async () => {
      const sb = supabase();
      const [p, s] = await Promise.all([
        sb.from("projects").select("id,name,archived").order("created_at", { ascending: false }),
        sb.from("stages").select("id,project_id,name,parent_id,sort_order").order("sort_order"),
      ]);
      setProjects((p.data ?? []) as ProjectLite[]);
      setStages((s.data ?? []) as StageLite[]);
    })();
  }, [loadList]);

  const openNote = useCallback(async (id: string) => {
    const { data } = await supabase().from("notes").select("*").eq("id", id).maybeSingle();
    const n = (data as Note | null) ?? null;
    setDraft(n);
    base.current = n?.updated_at ?? null;
    setDirty(false);
    setConflict(null);
    setSaveState("idle");
    setRk((k) => k + 1);
  }, []);

  useEffect(() => {
    if (selectedId) openNote(selectedId);
    else setDraft(null);
  }, [selectedId, openNote]);

  // ---- 저장 (자동) --------------------------------------------------------
  const save = useCallback(async (force = false): Promise<boolean> => {
    if (saving.current) await saving.current;
    const d = draftRef.current;
    if (!d || (!dirtyRef.current && !force)) return true;
    const run = (async () => {
      setSaveState("saving");
      const patch = {
        title: d.title,
        kind: d.kind,
        category: d.category,
        note_date: d.note_date,
        body_html: d.body_html,
        body_text: d.kind === "mindmap" ? mindmapText(d.mindmap) : d.body_html ? htmlToText(d.body_html) : null,
        mindmap: d.mindmap,
        project_id: d.project_id,
        stage_ids: d.stage_ids,
        visibility: d.visibility,
      };
      let qy = supabase().from("notes").update(patch).eq("id", d.id);
      if (!force && base.current) qy = qy.eq("updated_at", base.current);
      const { data, error } = await qy.select(LIST_COLS).maybeSingle();
      if (error) {
        setSaveState("error");
        return false;
      }
      if (!data) {
        // 그사이 다른 사람이 고침
        const { data: latest } = await supabase().from("notes").select("*").eq("id", d.id).maybeSingle();
        setConflict((latest as Note) ?? null);
        setSaveState("error");
        return false;
      }
      const row = data as Note;
      base.current = row.updated_at;
      if (draftRef.current === d) setDirty(false);
      setSaveState("saved");
      setNotes((ns) => ns.map((n) => (n.id === row.id ? { ...n, ...row } : n)));
      return true;
    })();
    saving.current = run;
    const ok = await run;
    saving.current = null;
    return ok;
  }, []);

  const change = (p: Partial<Note>) => {
    setDraft((d) => (d ? { ...d, ...p } : d));
    setDirty(true);
    setSaveState("idle");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!conflictRef.current) save();
    }, 1000);
  };
  const conflictRef = useRef(conflict);
  conflictRef.current = conflict;

  useUnsaved("note", `메모 '${draft?.title || "제목 없음"}'`, dirty, () => save());

  // 다른 메모로 옮기기 전에 저장
  const go = async (id: string | null, extra = "") => {
    if (timer.current) clearTimeout(timer.current);
    if (dirtyRef.current && !conflictRef.current) await save();
    router.replace(id ? `${path}?id=${id}${extra}` : path);
  };

  // ---- 실시간: 목록 갱신, 열린 메모를 남이 고치면 반영 --------------------
  useEffect(() => {
    if (missing) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = supabase()
      .channel("notes")
      .on("postgres_changes", { event: "*", schema: "public", table: "notes" }, (pl) => {
        if (t) clearTimeout(t);
        t = setTimeout(loadList, 400);
        const row = pl.new as Partial<Note> | undefined;
        const d = draftRef.current;
        if (!d || !row?.id || row.id !== d.id || row.updated_by === me?.id) return;
        if (row.updated_at && row.updated_at === base.current) return;
        if (!dirtyRef.current) openNote(d.id); // 내가 안 고치고 있으면 새 내용으로
      })
      .subscribe();
    return () => {
      if (t) clearTimeout(t);
      supabase().removeChannel(ch);
    };
  }, [missing, loadList, openNote, me?.id]);

  // ---- 새 메모 ----------------------------------------------------------
  const creating = useRef(false);
  const create = useCallback(
    async (kind: NoteKind, link?: { project?: string | null; stage?: string | null }) => {
      if (creating.current) return;
      creating.current = true;
      if (timer.current) clearTimeout(timer.current);
      if (dirtyRef.current) await save();
      const stageRow = link?.stage ? stages.find((s) => s.id === link.stage) : undefined;
      const { data, error } = await supabase()
        .from("notes")
        .insert({
          kind,
          category: cat === "all" ? (kind === "mindmap" ? "idea" : "memo") : cat,
          visibility: scope === "private" ? "private" : "shared",
          project_id: link?.project ?? stageRow?.project_id ?? (proj !== "all" && proj !== "none" ? proj : null),
          stage_ids: link?.stage ? [link.stage] : [],
          note_date: todayFn(),
        })
        .select("*")
        .single();
      creating.current = false;
      if (error || !data) {
        alert("메모를 만들지 못했습니다.\n" + (error?.message ?? ""));
        return;
      }
      setNotes((ns) => [data as Note, ...ns]);
      router.replace(`${path}?id=${(data as Note).id}&fresh=1`);
    },
    [cat, scope, proj, stages, router, save, path]
  );

  // 단계 패널에서 [+ 메모] → /notes?new=doc&project=..&stage=..
  const newParam = params.get("new");
  useEffect(() => {
    if (!newParam || loading || missing) return;
    if (newParam === "doc" || newParam === "mindmap") create(newParam, { project: params.get("project"), stage: params.get("stage") });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newParam, loading, missing, stages.length]);

  async function remove() {
    const d = draftRef.current;
    if (!d || !confirm(`'${d.title || "제목 없음"}' 메모를 지울까요?\n되돌릴 수 없습니다.`)) return;
    if (timer.current) clearTimeout(timer.current);
    setDirty(false);
    await supabase().from("notes").delete().eq("id", d.id);
    setNotes((ns) => ns.filter((n) => n.id !== d.id));
    router.replace(path);
  }

  // ---- 목록 ------------------------------------------------------------
  const projectName = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p.name])), [projects]);
  const stageById = useMemo(() => Object.fromEntries(stages.map((s) => [s.id, s])), [stages]);

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return notes.filter((n) => {
      if (n.id === selectedId) return true; // 열어 둔 메모는 필터와 상관없이 보이게
      if (cat !== "all" && n.category !== cat) return false;
      if (scope === "mine" && n.author_id !== me?.id) return false;
      if (scope === "private" && n.visibility !== "private") return false;
      if (proj === "none" && n.project_id) return false;
      if (proj !== "all" && proj !== "none" && n.project_id !== proj) return false;
      if (k) {
        const hay = `${n.title} ${n.body_text ?? ""} ${n.project_id ? projectName[n.project_id] ?? "" : ""} ${n.stage_ids.map((s) => stageById[s]?.name ?? "").join(" ")}`.toLowerCase();
        if (!hay.includes(k)) return false;
      }
      return true;
    });
  }, [notes, q, cat, scope, proj, me?.id, projectName, stageById, selectedId]);

  const grouped = useMemo(() => {
    const g: { month: string; items: Note[] }[] = [];
    shown.forEach((n) => {
      const m = n.note_date.slice(0, 7);
      const last = g[g.length - 1];
      if (last?.month === m) last.items.push(n);
      else g.push({ month: m, items: [n] });
    });
    return g;
  }, [shown]);

  const canEdit = !!draft && !!me && (draft.author_id === me.id || (draft.visibility === "shared" && !!me.is_game_part));
  const isAuthor = !!draft && draft.author_id === me?.id;
  const fresh = params.get("fresh") === "1";

  if (missing) {
    return (
      <div className="card mx-auto max-w-lg space-y-2 p-6 text-sm">
        <p className="font-semibold">메모 기능을 쓰려면 DB 업데이트가 필요합니다</p>
        <p className="text-slate-600">
          Supabase <b>SQL Editor</b>에 <code className="rounded bg-slate-100 px-1">supabase/014_notes.sql</code> 내용을 붙여넣고 <b>Run</b> 한 뒤 새로고침하세요.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] min-h-[520px] gap-4">
      {/* ---- 목록 ---- */}
      {!hideList && (
        <aside className={`card flex w-full shrink-0 flex-col overflow-hidden lg:w-[300px] ${selectedId ? "hidden lg:flex" : "flex"}`} data-tour="notes-list">
          <div className="space-y-2 border-b border-black/[0.06] p-3">
            <div className="flex items-center gap-1.5">
              <h1 className="text-base font-semibold">메모</h1>
              <Help content="회의록, 아이디어, 자유 메모를 남기는 곳입니다. 프로젝트와 상관없이 쓸 수 있고, 필요하면 프로젝트·단계에 연결해 그 단계 상세에서도 볼 수 있어요." />
              <div className="ml-auto flex gap-1" data-tour="notes-new">
                <button className="btn-primary px-2.5 py-1 text-xs" onClick={() => create("doc")}>
                  📄 문서
                </button>
                <button className="btn-outline px-2.5 py-1 text-xs" onClick={() => create("mindmap")}>
                  🧠 마인드맵
                </button>
              </div>
            </div>
            <input className="input py-1.5 text-sm" placeholder="제목·내용·프로젝트 검색" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="flex flex-wrap gap-1">
              {(["all", "meeting", "idea", "memo"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setCat(c)}
                  className={`rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${cat === c ? "bg-ink text-white ring-ink" : "text-slate-500 ring-black/10"}`}
                >
                  {c === "all" ? "전체" : `${CAT[c].icon} ${CAT[c].label}`}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5">
              <select className="input py-1 text-xs" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
                <option value="all">모든 메모</option>
                <option value="mine">내가 쓴 메모</option>
                <option value="private">🔒 나만 보기</option>
              </select>
              <select className="input py-1 text-xs" value={proj} onChange={(e) => setProj(e.target.value)}>
                <option value="all">모든 프로젝트</option>
                <option value="none">연결 없음</option>
                {projects
                  .filter((p) => !p.archived || notes.some((n) => n.project_id === p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <p className="p-6 text-center text-sm text-slate-400">불러오는 중…</p>
            ) : shown.length === 0 ? (
              <p className="p-6 text-center text-sm text-slate-400">{notes.length ? "조건에 맞는 메모가 없습니다." : "아직 메모가 없습니다. 위에서 새로 만들어 보세요."}</p>
            ) : (
              grouped.map((g) => (
                <div key={g.month}>
                  <div className="sticky top-0 z-[1] bg-white/95 px-3 pb-1 pt-3 text-[11px] font-medium text-slate-400 backdrop-blur">
                    {g.month.replace("-", "년 ").replace(/^(\d+년 )0?/, "$1")}월
                  </div>
                  <ul>
                    {g.items.map((n) => {
                      const active = n.id === selectedId;
                      const view = active && draft ? { ...n, ...draft } : n;
                      return (
                        <li key={n.id}>
                          <button
                            onClick={() => go(n.id)}
                            className={`block w-full border-l-2 px-3 py-2 text-left ${active ? "border-brand-500 bg-brand-500/[0.06]" : "border-transparent hover:bg-slate-50"}`}
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs">{KIND_ICON[view.kind]}</span>
                              <span className={`min-w-0 flex-1 truncate text-sm ${view.title ? "font-medium" : "text-slate-400"}`}>{view.title || "제목 없음"}</span>
                              {view.visibility === "private" && <span className="text-[10px]" title="나만 보기">🔒</span>}
                            </div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                              <span className={`rounded px-1 ${CAT[view.category].cls}`}>{CAT[view.category].label}</span>
                              <span className="tabular-nums">{view.note_date.slice(5).replace("-", "/")}</span>
                              {view.project_id && <span className="min-w-0 truncate">· {projectName[view.project_id] ?? "프로젝트"}</span>}
                              <span className="ml-auto shrink-0">{displayName(profileById[view.author_id ?? ""]).slice(0, 4)}</span>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
          </div>
        </aside>
      )}

      {/* ---- 편집 ---- */}
      <section className={`card min-w-0 flex-1 flex-col overflow-hidden ${selectedId ? "flex" : "hidden lg:flex"}`} data-tour="notes-editor">
        {!selectedId || !draft ? (
          <div className="grid flex-1 place-items-center p-10 text-center text-sm text-slate-400">
            {selectedId ? (
              "불러오는 중…"
            ) : (
              <div className="space-y-3">
                <p className="text-3xl">🗒️</p>
                <p>
                  왼쪽에서 메모를 고르거나
                  <br />
                  새 <b className="text-slate-600">문서</b> 또는 <b className="text-slate-600">마인드맵</b>을 만들어 보세요.
                </p>
                <div className="flex justify-center gap-2">
                  <button className="btn-primary text-xs" onClick={() => create("doc")}>
                    📄 새 문서
                  </button>
                  <button className="btn-outline text-xs" onClick={() => create("mindmap")}>
                    🧠 새 마인드맵
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* 머리 */}
            <div className="space-y-2 border-b border-black/[0.06] px-4 py-3">
              <div className="flex items-center gap-2">
                <button className="btn-ghost px-1.5 py-0.5 text-xs lg:hidden" onClick={() => go(null)}>
                  ← 목록
                </button>
                <Tip content={hideList ? "목록 보이기" : "목록 숨기고 넓게 쓰기"}>
                  <button className="btn-ghost hidden px-1.5 py-0.5 text-xs text-slate-500 lg:block" onClick={() => setHideList((v) => !v)}>
                    {hideList ? "⇥" : "⇤"}
                  </button>
                </Tip>
                <input
                  className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none placeholder:text-slate-300"
                  placeholder={draft.category === "meeting" ? "회의 제목 (예: 11월 전체 부서 미팅)" : draft.kind === "mindmap" ? "마인드맵 제목" : "제목"}
                  value={draft.title}
                  readOnly={!canEdit}
                  autoFocus={fresh}
                  onChange={(e) => change({ title: e.target.value })}
                  onBlur={() => {
                    // 마인드맵 가운데 주제가 아직 '중심 주제'면 제목으로
                    if (draft.kind !== "mindmap" || !canEdit || !draft.title.trim()) return;
                    if (!draft.mindmap) return setRk((k) => k + 1); // 아직 안 건드렸으면 제목으로 다시 그림
                    const next = withRootTitle(draft.mindmap, draft.title);
                    if (next) {
                      change({ mindmap: next });
                      setRk((k) => k + 1);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      (document.querySelector(".npd-note-body .ProseMirror, .npd-note-body me-tpc") as HTMLElement | null)?.focus();
                    }
                  }}
                />
                <span className="shrink-0 text-[11px] text-slate-400">
                  {!canEdit ? "읽기 전용" : saveState === "saving" ? "저장 중…" : dirty ? "고치는 중" : saveState === "error" ? <span className="text-rose-600">저장 안 됨</span> : "저장됨"}
                </span>
                <NoteMenu
                  kind={draft.kind}
                  canDelete={isAuthor || !!me?.is_admin}
                  onDelete={remove}
                  onPng={async () => {
                    const blob = await mapRef.current?.exportPng();
                    if (!blob) return;
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = `${draft.title || "마인드맵"}.png`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
                  }}
                  onOutline={async () => {
                    const html = mapRef.current?.outlineHtml();
                    if (!html) return;
                    const { data } = await supabase()
                      .from("notes")
                      .insert({ kind: "doc", title: `${draft.title || "마인드맵"} (개요)`, category: draft.category, body_html: html, body_text: htmlToText(html), project_id: draft.project_id, stage_ids: draft.stage_ids, visibility: draft.visibility, note_date: draft.note_date })
                      .select("id")
                      .single();
                    if (data) go((data as { id: string }).id);
                  }}
                />
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
                <div className="flex gap-1">
                  {(["meeting", "idea", "memo"] as NoteCategory[]).map((c) => (
                    <button
                      key={c}
                      disabled={!canEdit}
                      onClick={() => change({ category: c })}
                      className={`rounded-full px-2 py-0.5 ring-1 ring-inset disabled:opacity-60 ${draft.category === c ? `${CAT[c].cls} ring-transparent font-medium` : "text-slate-500 ring-black/10"}`}
                    >
                      {CAT[c].icon} {CAT[c].label}
                    </button>
                  ))}
                </div>
                <input type="date" className="rounded-md border border-black/10 px-1.5 py-0.5 text-xs" value={draft.note_date} disabled={!canEdit} onChange={(e) => e.target.value && change({ note_date: e.target.value })} />
                {isAuthor ? (
                  <Tip content={draft.visibility === "shared" ? "팀 전체가 볼 수 있고, 게임파트는 함께 고칠 수 있어요. 누르면 나만 보기로." : "나만 볼 수 있어요. 누르면 팀 공개로."}>
                    <button className="rounded-full px-2 py-0.5 text-slate-600 ring-1 ring-inset ring-black/10 hover:bg-slate-50" onClick={() => change({ visibility: draft.visibility === "shared" ? "private" : "shared" })}>
                      {draft.visibility === "shared" ? "👥 팀 공개" : "🔒 나만 보기"}
                    </button>
                  </Tip>
                ) : (
                  <span className="text-slate-400">{draft.visibility === "shared" ? "👥 팀 공개" : "🔒 나만 보기"}</span>
                )}
                <span className="text-slate-400">
                  {displayName(profileById[draft.author_id ?? ""])} 작성
                  {draft.updated_by && draft.updated_by !== draft.author_id && ` · ${displayName(profileById[draft.updated_by])} 수정`} · {relativeTime(draft.updated_at)}
                </span>
              </div>

              <NoteLinks
                projects={projects}
                stages={stages}
                projectId={draft.project_id}
                stageIds={draft.stage_ids}
                disabled={!canEdit}
                onChange={(project_id, stage_ids) => change({ project_id, stage_ids })}
              />
            </div>

            {conflict && (
              <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
                <span>
                  <b>{displayName(profileById[conflict.updated_by ?? ""])}</b>님이 방금 이 메모를 고쳤습니다. 어느 쪽으로 할까요?
                </span>
                <button
                  className="btn-outline ml-auto bg-white py-0.5 text-xs"
                  onClick={() => {
                    setConflict(null);
                    openNote(conflict.id);
                  }}
                >
                  상대 내용 불러오기
                </button>
                <button
                  className="btn-primary py-0.5 text-xs"
                  onClick={async () => {
                    setConflict(null);
                    await save(true);
                  }}
                >
                  내 내용으로 덮어쓰기
                </button>
              </div>
            )}

            {/* 본문 */}
            <div className="npd-note-body flex min-h-0 flex-1 flex-col">
              {draft.kind === "doc" ? (
                <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
                  {canEdit && draft.category === "meeting" && isEmptyHtml(draft.body_html) && (
                    <button
                      className="self-start rounded-md bg-violet-50 px-2 py-1 text-xs text-violet-700 hover:bg-violet-100"
                      onClick={() => {
                        change({ body_html: MEETING_TEMPLATE });
                        setRk((k) => k + 1);
                      }}
                    >
                      + 회의록 틀 넣기 (참석자·안건·논의·결정·할 일)
                    </button>
                  )}
                  <div className="min-h-0 flex-1">
                    <RichEditor
                      value={draft.body_html ?? ""}
                      resetKey={`${draft.id}-${rk}`}
                      disabled={!canEdit}
                      onChange={(html) => change({ body_html: html || null })}
                      onSubmit={() => save()}
                      large
                      fill
                      minHeight={400}
                      placeholder="자유롭게 적어보세요. (Ctrl+1~4 글자 크기 · 자동 저장)"
                    />
                  </div>
                </div>
              ) : (
                <>
                  <div className="relative min-h-0 flex-1">
                    <MindMap ref={mapRef} value={draft.mindmap} resetKey={`${draft.id}-${rk}`} readOnly={!canEdit} rootTitle={draft.title} onChange={(data) => change({ mindmap: data })} />
                  </div>
                  {canEdit && (
                    <p className="border-t border-black/[0.06] px-4 py-1.5 text-[11px] text-slate-400">
                      <b className="font-medium text-slate-500">Tab</b> 하위 생각 · <b className="font-medium text-slate-500">Enter</b> 같은 단계 · <b className="font-medium text-slate-500">F2</b>·두 번 눌러 고치기 ·{" "}
                      <b className="font-medium text-slate-500">Delete</b> 지우기 · <b className="font-medium text-slate-500">Ctrl+Z</b> 되돌리기 · 끌어서 옮기기 · 오른쪽 클릭 메뉴 · 빈 곳을 끌어 화면 이동, Ctrl+휠 확대
                    </p>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// ---- ⋯ 메뉴 ---------------------------------------------------------------
function NoteMenu({ kind, canDelete, onDelete, onPng, onOutline }: { kind: NoteKind; canDelete: boolean; onDelete: () => void; onPng: () => void; onOutline: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [open]);
  if (kind === "doc" && !canDelete) return null;
  return (
    <div className="relative" ref={ref}>
      <button className="btn-ghost px-2 py-0.5" onClick={() => setOpen((v) => !v)} aria-label="더보기">
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-48 overflow-hidden rounded-lg border border-black/10 bg-white py-1 text-sm shadow-lg">
          {kind === "mindmap" && (
            <>
              <button className="block w-full px-3 py-1.5 text-left hover:bg-slate-50" onClick={() => (setOpen(false), onPng())}>
                🖼️ 이미지로 저장 (PNG)
              </button>
              <button className="block w-full px-3 py-1.5 text-left hover:bg-slate-50" onClick={() => (setOpen(false), onOutline())}>
                📄 개요를 새 문서로
              </button>
            </>
          )}
          {canDelete && (
            <button className="block w-full px-3 py-1.5 text-left text-rose-600 hover:bg-rose-50" onClick={() => (setOpen(false), onDelete())}>
              메모 지우기
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---- 프로젝트·단계 연결 -----------------------------------------------------
function NoteLinks({
  projects,
  stages,
  projectId,
  stageIds,
  disabled,
  onChange,
}: {
  projects: ProjectLite[];
  stages: StageLite[];
  projectId: string | null;
  stageIds: string[];
  disabled: boolean;
  onChange: (projectId: string | null, stageIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [sq, setSq] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [open]);

  const proj = projects.find((p) => p.id === projectId);
  const projStages = useMemo(() => {
    if (!projectId) return [] as { s: StageLite; depth: number }[];
    const list = stages.filter((s) => s.project_id === projectId);
    const kids: Record<string, StageLite[]> = {};
    list.forEach((s) => (kids[s.parent_id ?? "root"] ??= []).push(s));
    const out: { s: StageLite; depth: number }[] = [];
    const walk = (pid: string, d: number) => (kids[pid] ?? []).sort((a, b) => a.sort_order - b.sort_order).forEach((s) => (out.push({ s, depth: d }), walk(s.id, d + 1)));
    walk("root", 0);
    // 부모가 목록에 없는 단계(꼬인 데이터)도 보이게
    list.forEach((s) => !out.some((o) => o.s.id === s.id) && out.push({ s, depth: 0 }));
    return out;
  }, [stages, projectId]);
  const nameOf = (id: string) => stages.find((s) => s.id === id)?.name ?? "지워진 단계";
  const k = sq.trim().toLowerCase();

  return (
    <div className="relative flex flex-wrap items-center gap-1.5 text-xs" ref={ref} data-tour="notes-link">
      <span className="text-slate-400">연결</span>
      {!projectId ? (
        <span className="text-slate-300">없음</span>
      ) : (
        <>
          <Link href={`/projects/${projectId}`} className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700 hover:bg-slate-200">
            {proj?.name ?? "프로젝트"}
          </Link>
          {stageIds.map((id) => (
            <span key={id} className="flex items-center gap-0.5 rounded bg-brand-500/[0.08] py-0.5 pl-1.5 pr-1 text-brand-700">
              <Link href={`/projects/${projectId}?stage=${id}`} className="hover:underline">
                {nameOf(id)}
              </Link>
              {!disabled && (
                <button className="px-0.5 text-brand-700/60 hover:text-rose-600" onClick={() => onChange(projectId, stageIds.filter((x) => x !== id))} aria-label="연결 끊기">
                  ×
                </button>
              )}
            </span>
          ))}
        </>
      )}
      {!disabled && (
        <button className="rounded px-1.5 py-0.5 text-slate-500 ring-1 ring-inset ring-black/10 hover:bg-slate-50" onClick={() => setOpen((v) => !v)}>
          {projectId ? "바꾸기" : "+ 프로젝트·단계 연결"}
        </button>
      )}
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-[min(420px,90vw)] rounded-lg border border-black/10 bg-white p-2 shadow-lg">
          <select
            className="input py-1 text-sm"
            value={projectId ?? ""}
            onChange={(e) => {
              const v = e.target.value || null;
              onChange(v, v === projectId ? stageIds : []);
              setSq("");
            }}
          >
            <option value="">— 연결 안 함 —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.archived ? " (보관)" : ""}
              </option>
            ))}
          </select>
          {projectId && (
            <>
              <input className="input mt-2 py-1 text-sm" placeholder="단계 검색" value={sq} onChange={(e) => setSq(e.target.value)} />
              <ul className="scroll-thin mt-1 max-h-64 overflow-y-auto">
                {projStages
                  .filter(({ s }) => !k || s.name.toLowerCase().includes(k))
                  .map(({ s, depth }) => {
                    const on = stageIds.includes(s.id);
                    return (
                      <li key={s.id}>
                        <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-slate-50" style={{ paddingLeft: 6 + (k ? 0 : depth * 14) }}>
                          <input type="checkbox" checked={on} onChange={() => onChange(projectId, on ? stageIds.filter((x) => x !== s.id) : [...stageIds, s.id])} />
                          <span className="truncate text-sm">{s.name}</span>
                        </label>
                      </li>
                    );
                  })}
                {projStages.length === 0 && <li className="px-2 py-2 text-slate-400">단계가 없습니다.</li>}
              </ul>
              <p className="mt-1 px-1 text-[11px] text-slate-400">단계를 고르지 않으면 프로젝트에만 연결됩니다. 연결한 단계의 상세 화면에 이 메모가 보여요.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
