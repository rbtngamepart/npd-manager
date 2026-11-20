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
import type { Note, NoteCategory, NoteFolder, NoteKind, Project, Stage } from "@/lib/types";
import { NoteTree } from "@/components/NoteTree";
import { copyText, useContextMenu, type CtxItem } from "@/components/ContextMenu";
import { Backlinks, COVERS, CoverPicker, IconPicker, NewNoteMenu, Toc, VersionsModal, type NewChoice } from "@/components/NoteExtras";
import { extractRefs, newMentions, notifyMentions } from "@/lib/noteRefs";
import { exportMarkdown, exportMarkdownText, exportPrint, exportWord } from "@/lib/exportNote";
import type { NoteVersion } from "@/lib/types";

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
const PLUS_COLS = ",icon,cover,deleted_at,is_template,mention_ids,ref_note_ids,ref_stage_ids";
const RECENT_KEY = "npd-notes-recent";

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
  const [scope, setScope] = useState<"all" | "mine" | "private" | "mentioned">("all");
  const [proj, setProj] = useState<string>("all");
  const [hideList, setHideList] = useState(false);

  // 폴더 (업데이트 015)
  const [folders, setFolders] = useState<NoteFolder[]>([]);
  const [noFolders, setNoFolders] = useState(false);
  const noFoldersRef = useRef(false);
  noFoldersRef.current = noFolders;
  const [curFolder, setCurFolder] = useState<string | null>(null);
  const [view, setViewState] = useState<"tree" | "date">("tree");
  useEffect(() => {
    try {
      if (localStorage.getItem("npd-notes-view") === "date") setViewState("date");
    } catch {
      /* 무시 */
    }
  }, []);
  const setView = (v: "tree" | "date") => {
    setViewState(v);
    try {
      localStorage.setItem("npd-notes-view", v);
    } catch {
      /* 무시 */
    }
  };

  // 노션식 기능 (업데이트 016)
  const [plus, setPlus] = useState(true);
  const plusRef = useRef(true);
  plusRef.current = plus;
  const [trashView, setTrashView] = useState(false);
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [recents, setRecents] = useState<string[]>([]);
  const [newMenu, setNewMenu] = useState(false);
  const [pop, setPop] = useState<"icon" | "cover" | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [toc, setTocState] = useState(true);
  const [toast, setToast] = useState<{ text: string; action?: { label: string; run: () => void } } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = (text: string, action?: { label: string; run: () => void }) => {
    setToast({ text, action });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  };
  const savedMentions = useRef<string[]>([]);
  useEffect(() => {
    try {
      const r = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
      if (Array.isArray(r)) setRecents(r.filter((x) => typeof x === "string").slice(0, 10));
      if (localStorage.getItem("npd-notes-toc") === "off") setTocState(false);
    } catch {
      /* 무시 */
    }
  }, []);
  const setToc = (v: boolean) => {
    setTocState(v);
    try {
      localStorage.setItem("npd-notes-toc", v ? "on" : "off");
    } catch {
      /* 무시 */
    }
  };
  const listCols = () => (noFoldersRef.current ? LIST_COLS : LIST_COLS + ",folder_id" + (plusRef.current ? PLUS_COLS : ""));

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
    const q = (cols: string) => supabase().from("notes").select(cols).order("note_date", { ascending: false }).order("updated_at", { ascending: false });
    let { data, error } = await q(listCols());
    if (error && plusRef.current && /icon|cover|deleted_at|is_template|mention_ids|ref_|column/i.test(error.message)) {
      plusRef.current = false;
      setPlus(false); // 016 전: 노션식 기능 없이
      ({ data, error } = await q(listCols()));
    }
    if (error && !noFoldersRef.current && /folder_id|column/i.test(error.message)) {
      noFoldersRef.current = true;
      setNoFolders(true); // 015 전: 폴더 없이
      ({ data, error } = await q(LIST_COLS));
    }
    if (error) {
      if (/notes|relation|schema cache/i.test(error.message)) setMissing(true);
    } else setNotes((data ?? []) as unknown as Note[]);
    setLoading(false);
  }, []);

  const loadFolders = useCallback(async () => {
    const { data, error } = await supabase().from("note_folders").select("*");
    if (error) setNoFolders(true);
    else setFolders((data ?? []) as NoteFolder[]);
  }, []);

  const loadFavs = useCallback(async () => {
    const { data, error } = await supabase().from("note_favorites").select("note_id");
    if (!error) setFavs(new Set(((data ?? []) as { note_id: string }[]).map((x) => x.note_id)));
  }, []);

  useEffect(() => {
    loadList();
    loadFolders();
    loadFavs();
    (async () => {
      const sb = supabase();
      const [p, s] = await Promise.all([
        sb.from("projects").select("id,name,archived").order("created_at", { ascending: false }),
        sb.from("stages").select("id,project_id,name,parent_id,sort_order").order("sort_order"),
      ]);
      setProjects((p.data ?? []) as ProjectLite[]);
      setStages((s.data ?? []) as StageLite[]);
    })();
  }, [loadList, loadFolders, loadFavs]);

  const openNote = useCallback(async (id: string) => {
    const { data } = await supabase().from("notes").select("*").eq("id", id).maybeSingle();
    const n = (data as Note | null) ?? null;
    setDraft(n);
    savedMentions.current = n?.mention_ids ?? [];
    if (n) {
      setCurFolder(n.folder_id ?? null);
      if (!n.is_template && !n.deleted_at)
        setRecents((r) => {
          const next = [n.id, ...r.filter((x) => x !== n.id)].slice(0, 10);
          try {
            localStorage.setItem(RECENT_KEY, JSON.stringify(next));
          } catch {
            /* 무시 */
          }
          return next;
        });
    }
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
        ...(noFoldersRef.current ? {} : { folder_id: d.folder_id ?? null }),
        ...(plusRef.current && !noFoldersRef.current
          ? (() => {
              const r = d.kind === "doc" ? extractRefs(d.body_html) : { mentions: [], notes: [], stages: [] };
              return { icon: d.icon ?? null, cover: d.cover ?? null, mention_ids: r.mentions, ref_note_ids: r.notes.filter((x) => x !== d.id), ref_stage_ids: r.stages };
            })()
          : {}),
      };
      let qy = supabase().from("notes").update(patch).eq("id", d.id);
      if (!force && base.current) qy = qy.eq("updated_at", base.current);
      const { data, error } = await qy.select(listCols()).maybeSingle();
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
      const row = data as unknown as Note;
      base.current = row.updated_at;
      // 새로 언급한 사람에게 알림 (팀 공개 메모만, 서버에서 다시 확인)
      if (row.mention_ids) {
        const fresh = newMentions(savedMentions.current, row.mention_ids);
        savedMentions.current = row.mention_ids;
        if (fresh.length) void notifyMentions({ kind: "note", id: row.id, mentioned: fresh });
      }
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
    let t2: ReturnType<typeof setTimeout> | null = null;
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
      .on("postgres_changes", { event: "*", schema: "public", table: "note_folders" }, () => {
        if (t2) clearTimeout(t2);
        t2 = setTimeout(loadFolders, 300);
      })
      .subscribe();
    return () => {
      if (t) clearTimeout(t);
      if (t2) clearTimeout(t2);
      supabase().removeChannel(ch);
    };
  }, [missing, loadList, loadFolders, openNote, me?.id]);

  // ---- 새 메모 ----------------------------------------------------------
  const creating = useRef(false);
  const create = useCallback(
    async (
      kind: NoteKind,
      link?: { project?: string | null; stage?: string | null },
      folder: string | null = curFolder,
      opts: { preset?: "meeting"; template?: Note } = {}
    ) => {
      if (creating.current) return;
      creating.current = true;
      if (timer.current) clearTimeout(timer.current);
      if (dirtyRef.current) await save();
      const stageRow = link?.stage ? stages.find((s) => s.id === link.stage) : undefined;
      // 템플릿이면 내용을 가져와서 복사
      let from: Partial<Note> = {};
      if (opts.template) {
        const { data: t } = await supabase().from("notes").select("*").eq("id", opts.template.id).maybeSingle();
        const tn = t as Note | null;
        if (tn) from = { kind: tn.kind, title: tn.title, category: tn.category, body_html: tn.body_html, body_text: tn.body_text, mindmap: tn.mindmap, icon: tn.icon, cover: tn.cover };
      } else if (opts.preset === "meeting") {
        from = { category: "meeting", body_html: MEETING_TEMPLATE, body_text: htmlToText(MEETING_TEMPLATE), icon: plusRef.current ? "👥" : undefined };
      }
      const { data, error } = await supabase()
        .from("notes")
        .insert({
          kind,
          category: cat === "all" ? (kind === "mindmap" ? "idea" : "memo") : cat,
          ...from,
          visibility: scope === "private" ? "private" : "shared",
          project_id: link?.project ?? stageRow?.project_id ?? (proj !== "all" && proj !== "none" ? proj : null),
          stage_ids: link?.stage ? [link.stage] : [],
          note_date: todayFn(),
          ...(noFoldersRef.current || link?.stage ? {} : { folder_id: folder }),
        })
        .select("*")
        .single();
      creating.current = false;
      setTrashView(false);
      if (error || !data) {
        alert("메모를 만들지 못했습니다.\n" + (error?.message ?? ""));
        return;
      }
      setNotes((ns) => [data as Note, ...ns]);
      router.replace(`${path}?id=${(data as Note).id}&fresh=1`);
    },
    [cat, scope, proj, stages, router, save, path, curFolder]
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
    if (!d) return;
    if (!plusRef.current) {
      if (!confirm(`'${d.title || "제목 없음"}' 메모를 지울까요?\n되돌릴 수 없습니다.`)) return;
      if (timer.current) clearTimeout(timer.current);
      setDirty(false);
      await supabase().from("notes").delete().eq("id", d.id);
      setNotes((ns) => ns.filter((n) => n.id !== d.id));
      router.replace(path);
      return;
    }
    // 휴지통으로 (30일 뒤 자동 삭제)
    if (timer.current) clearTimeout(timer.current);
    if (dirtyRef.current) await save();
    setDirty(false);
    const { data, error } = await supabase().from("notes").update({ deleted_at: new Date().toISOString() }).eq("id", d.id).select("id");
    if (error || !data?.length) return alert("휴지통으로 옮기지 못했습니다. 권한을 확인하세요.");
    setNotes((ns) => ns.map((n) => (n.id === d.id ? { ...n, deleted_at: new Date().toISOString() } : n)));
    router.replace(path);
    say(`'${d.title || "제목 없음"}'을(를) 휴지통으로 옮겼습니다`, { label: "되돌리기", run: () => restore(d.id, true) });
  }
  async function restore(id: string, open = false) {
    const { data, error } = await supabase().from("notes").update({ deleted_at: null }).eq("id", id).select("id");
    if (error || !data?.length) return alert("되살리지 못했습니다. 권한을 확인하세요.");
    setNotes((ns) => ns.map((n) => (n.id === id ? { ...n, deleted_at: null } : n)));
    if (draftRef.current?.id === id) setDraft((x) => (x ? { ...x, deleted_at: null } : x));
    if (open) router.replace(`${path}?id=${id}`);
    say("되살렸습니다");
  }
  async function destroy(n: Note) {
    if (!confirm(`'${n.title || "제목 없음"}'을(를) 완전히 지울까요?\n되돌릴 수 없습니다.`)) return;
    const { data, error } = await supabase().from("notes").delete().eq("id", n.id).select("id");
    if (error || !data?.length) return alert("지우지 못했습니다. 완전 삭제는 작성자나 관리자만 할 수 있어요.");
    setNotes((ns) => ns.filter((x) => x.id !== n.id));
    if (selectedId === n.id) router.replace(path);
  }
  async function openTrash() {
    setTrashView(true);
    await supabase().rpc("note_trash_purge"); // 30일 지난 것 정리
    loadList();
  }

  // ---- 즐겨찾기 · 템플릿 -------------------------------------------------
  async function toggleFav(id: string) {
    const on = favs.has(id);
    setFavs((f) => {
      const n = new Set(f);
      if (on) n.delete(id);
      else n.add(id);
      return n;
    });
    const r = on ? await supabase().from("note_favorites").delete().eq("note_id", id).eq("user_id", me?.id ?? "") : await supabase().from("note_favorites").insert({ note_id: id });
    if (r.error) loadFavs();
  }
  async function saveAsTemplate() {
    const d = draftRef.current;
    if (!d) return;
    const name = window.prompt("템플릿 이름", d.title || (d.kind === "mindmap" ? "마인드맵 템플릿" : "새 템플릿"));
    if (name === null) return;
    const { data, error } = await supabase()
      .from("notes")
      .insert({
        is_template: true,
        title: name.trim() || "새 템플릿",
        kind: d.kind,
        category: d.category,
        body_html: d.body_html,
        body_text: d.body_text,
        mindmap: d.mindmap,
        icon: d.icon ?? null,
        cover: d.cover ?? null,
        visibility: d.visibility,
        note_date: todayFn(),
      })
      .select(listCols())
      .single();
    if (error || !data) return alert("템플릿을 저장하지 못했습니다.\n" + (error?.message ?? ""));
    setNotes((ns) => [data as unknown as Note, ...ns]);
    say("템플릿으로 저장했습니다. [＋ ▾] 메뉴에서 골라 새 메모를 만들 수 있어요.");
  }
  async function deleteTemplate(t: Note) {
    if (!confirm(`'${t.title || "템플릿"}' 템플릿을 지울까요?`)) return;
    const { data, error } = await supabase().from("notes").delete().eq("id", t.id).select("id");
    if (error || !data?.length) return alert("지우지 못했습니다. 템플릿을 만든 사람이나 관리자만 지울 수 있어요.");
    setNotes((ns) => ns.filter((x) => x.id !== t.id));
  }
  // ---- 오른쪽 클릭 메뉴 -------------------------------------------------
  const openMenu = useContextMenu();
  const canEditNote = (n: Note) => !!me && !n.deleted_at && (n.author_id === me.id || (n.visibility === "shared" && !!me.is_game_part));
  async function duplicateNote(n: Note) {
    if (dirtyRef.current) await save();
    const { data: full } = await supabase().from("notes").select("*").eq("id", n.id).maybeSingle();
    const f = full as Note | null;
    if (!f) return;
    const { id: _id, created_at: _c, updated_at: _u, author_id: _a, updated_by: _b, deleted_at: _d, ...rest } = f;
    void _id; void _c; void _u; void _a; void _b; void _d;
    const { data, error } = await supabase()
      .from("notes")
      .insert({ ...rest, title: `${f.title || "제목 없음"} (사본)`, is_template: false })
      .select(listCols())
      .single();
    if (error || !data) return alert("복제하지 못했습니다.\n" + (error?.message ?? ""));
    setNotes((ns) => [data as unknown as Note, ...ns]);
    go((data as unknown as Note).id);
    say("사본을 만들었습니다");
  }
  async function trashNote(n: Note) {
    if (draftRef.current?.id === n.id) return remove();
    const { data, error } = await supabase().from("notes").update({ deleted_at: new Date().toISOString() }).eq("id", n.id).select("id");
    if (error || !data?.length) return alert("휴지통으로 옮기지 못했습니다. 권한을 확인하세요.");
    setNotes((ns) => ns.map((x) => (x.id === n.id ? { ...x, deleted_at: new Date().toISOString() } : x)));
    say(`'${n.title || "제목 없음"}'을(를) 휴지통으로 옮겼습니다`, { label: "되돌리기", run: () => restore(n.id) });
  }
  function noteMenu(e: React.MouseEvent, n: Note) {
    const url = `${window.location.origin}/notes?id=${n.id}`;
    const edit = canEditNote(n);
    if (n.deleted_at) {
      openMenu(e, [
        { header: n.title || "제목 없음" },
        { icon: "↗", label: "내용 보기", run: () => go(n.id) },
        { icon: "↺", label: "되살리기", run: () => restore(n.id) },
        (n.author_id === me?.id || !!me?.is_admin) && { icon: "🗑", label: "완전 삭제", danger: true, run: () => destroy(n) },
      ]);
      return;
    }
    const moveTo: CtxItem[] = [
      { label: "— 폴더 밖", checked: !n.folder_id, run: () => moveNote(n.id, null) },
      ...folderOptions.map(({ f, depth }) => ({ label: `${"\u3000".repeat(depth)}📁 ${f.name}`, checked: n.folder_id === f.id, run: () => moveNote(n.id, f.id) })),
    ];
    openMenu(e, [
      { header: n.title || "제목 없음" },
      { icon: "↗", label: "열기", run: () => go(n.id) },
      { icon: "⧉", label: "새 탭에서 열기", run: () => window.open(url, "_blank") },
      { icon: "🔗", label: "링크 복사", run: async () => (await copyText(url)) && say("링크를 복사했습니다") },
      plus && { icon: favs.has(n.id) ? "★" : "☆", label: favs.has(n.id) ? "즐겨찾기에서 빼기" : "즐겨찾기", run: () => toggleFav(n.id) },
      "sep",
      { icon: "⧉", label: "복제 (사본 만들기)", run: () => duplicateNote(n) },
      edit && !noFolders && { icon: "📁", label: "폴더로 옮기기", children: moveTo },
      edit && n.author_id === me?.id && { icon: n.visibility === "shared" ? "🔒" : "👥", label: n.visibility === "shared" ? "나만 보기로" : "팀 공개로", run: async () => {
        if (draftRef.current?.id === n.id) return change({ visibility: n.visibility === "shared" ? "private" : "shared" });
        const v = n.visibility === "shared" ? "private" : "shared";
        const { error } = await supabase().from("notes").update({ visibility: v }).eq("id", n.id);
        if (!error) setNotes((ns) => ns.map((x) => (x.id === n.id ? { ...x, visibility: v } : x)));
      } },
      (plus ? edit : n.author_id === me?.id || !!me?.is_admin) && "sep",
      (plus ? edit : n.author_id === me?.id || !!me?.is_admin) && { icon: "🗑", label: plus ? "휴지통으로" : "지우기", danger: true, run: () => (plus ? trashNote(n) : draftRef.current?.id === n.id ? remove() : destroy(n)) },
    ]);
  }

  function pickNew(c: NewChoice) {
    if ("template" in c) create(c.template.kind, undefined, curFolder, { template: c.template });
    else create(c.kind, undefined, curFolder, { preset: c.preset });
  }

  // ---- 폴더 ------------------------------------------------------------
  async function createFolder(parent: string | null): Promise<string | undefined> {
    const par = folders.find((f) => f.id === parent);
    const { data, error } = await supabase()
      .from("note_folders")
      .insert({ name: "새 폴더", parent_id: parent, visibility: par?.visibility === "private" ? "private" : "shared" })
      .select("*")
      .single();
    if (error || !data) {
      alert("폴더를 만들지 못했습니다.\n" + (error?.message ?? ""));
      return;
    }
    setFolders((fs) => [...fs, data as NoteFolder]);
    setCurFolder((data as NoteFolder).id);
    return (data as NoteFolder).id;
  }
  async function updateFolder(id: string, patch: Partial<NoteFolder>) {
    const prev = folders;
    setFolders((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    const { data, error } = await supabase().from("note_folders").update(patch).eq("id", id).select("id");
    if (error || !data?.length) {
      setFolders(prev);
      alert(error?.message.includes("자기 안") ? "폴더를 자기 안(하위 폴더)으로 옮길 수 없습니다." : "폴더를 바꾸지 못했습니다. 권한을 확인하세요.");
    }
  }
  async function deleteFolder(f: NoteFolder) {
    const inside = notes.filter((n) => n.folder_id === f.id).length;
    const sub = folders.filter((x) => x.parent_id === f.id).length;
    const where = f.parent_id ? "위 폴더로" : "폴더 밖으로";
    if (!confirm(`'${f.name}' 폴더를 지울까요?${inside || sub ? `\n안에 있는 ${[inside && `메모 ${inside}개`, sub && `하위 폴더 ${sub}개`].filter(Boolean).join(", ")}은(는) 지워지지 않고 ${where} 옮겨집니다.` : ""}`)) return;
    if (timer.current) clearTimeout(timer.current);
    if (dirtyRef.current) await save(); // 고치던 내용 먼저 저장
    const { error } = await supabase().rpc("note_folder_delete", { p_id: f.id });
    if (error) return alert(error.message);
    if (curFolder === f.id) setCurFolder(f.parent_id);
    // 열린 메모가 그 폴더에 있었으면 서버에서 옮겨졌으니 다시 불러옴 (저장 충돌 방지)
    const d = draftRef.current;
    if (d?.folder_id === f.id) {
      openNote(d.id);
    }
    loadFolders();
    loadList();
  }
  async function moveNote(noteId: string, folderId: string | null) {
    if (draftRef.current?.id === noteId) return change({ folder_id: folderId });
    const prev = notes;
    setNotes((ns) => ns.map((n) => (n.id === noteId ? { ...n, folder_id: folderId } : n)));
    const { data, error } = await supabase().from("notes").update({ folder_id: folderId }).eq("id", noteId).select("id");
    if (error || !data?.length) {
      setNotes(prev);
      alert("이 메모를 옮길 권한이 없습니다. (작성자나 게임파트만 옮길 수 있어요)");
    }
  }
  const folderPath = useCallback(
    (id: string | null | undefined): string => {
      const names: string[] = [];
      let cur = id ? folders.find((f) => f.id === id) : undefined;
      let guard = 0;
      while (cur && guard++ < 50) {
        names.unshift(cur.name);
        cur = cur.parent_id ? folders.find((f) => f.id === cur!.parent_id) : undefined;
      }
      return names.join(" › ");
    },
    [folders]
  );
  const folderOptions = useMemo(() => {
    const kids: Record<string, NoteFolder[]> = {};
    const ids = new Set(folders.map((f) => f.id));
    folders.forEach((f) => (kids[f.parent_id && ids.has(f.parent_id) ? f.parent_id : "root"] ??= []).push(f));
    const out: { f: NoteFolder; depth: number }[] = [];
    const walk = (pid: string, d: number) =>
      (kids[pid] ?? []).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ko", { numeric: true })).forEach((f) => (out.push({ f, depth: d }), d < 30 && walk(f.id, d + 1)));
    walk("root", 0);
    return out;
  }, [folders]);

  // ---- 목록 ------------------------------------------------------------
  const projectName = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p.name])), [projects]);
  const stageById = useMemo(() => Object.fromEntries(stages.map((s) => [s.id, s])), [stages]);

  const live = useMemo(() => notes.filter((n) => !n.deleted_at && !n.is_template), [notes]);
  const trash = useMemo(() => notes.filter((n) => n.deleted_at && !n.is_template), [notes]);
  const templates = useMemo(() => notes.filter((n) => n.is_template && !n.deleted_at), [notes]);

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return live.filter((n) => {
      if (n.id === selectedId) return true; // 열어 둔 메모는 필터와 상관없이 보이게
      if (cat !== "all" && n.category !== cat) return false;
      if (scope === "mine" && n.author_id !== me?.id) return false;
      if (scope === "mentioned" && !(n.mention_ids ?? []).includes(me?.id ?? "")) return false;
      if (scope === "private" && n.visibility !== "private") return false;
      if (proj === "none" && n.project_id) return false;
      if (proj !== "all" && proj !== "none" && n.project_id !== proj) return false;
      if (k) {
        const hay = `${n.title} ${folderPath(n.folder_id)} ${n.body_text ?? ""} ${n.project_id ? projectName[n.project_id] ?? "" : ""} ${n.stage_ids.map((s) => stageById[s]?.name ?? "").join(" ")}`.toLowerCase();
        if (!hay.includes(k)) return false;
      }
      return true;
    });
  }, [live, q, cat, scope, proj, me?.id, projectName, stageById, selectedId, folderPath]);
  const filtering = !!q.trim() || cat !== "all" || scope !== "all" || proj !== "all";

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

  const canEdit = !!draft && !!me && !draft.deleted_at && (draft.author_id === me.id || (draft.visibility === "shared" && !!me.is_game_part));
  const favList = live.filter((n) => favs.has(n.id));
  const recentList = recents.map((id) => live.find((n) => n.id === id)).filter((n): n is Note => !!n && !favs.has(n.id)).slice(0, 5);
  const isAuthor = !!draft && draft.author_id === me?.id;
  const fresh = params.get("fresh") === "1";

  const exportMeta = () =>
    draft ? `${CAT[draft.category].label} · ${draft.note_date.replace(/-/g, ".")} · ${displayName(profileById[draft.author_id ?? ""])}${draft.project_id ? ` · ${projectName[draft.project_id] ?? ""}` : ""}` : "";

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
              <div className="relative ml-auto flex gap-1" data-tour="notes-new">
                <button className="btn-primary px-2.5 py-1 text-xs" onClick={() => create("doc")} title={curFolder && !noFolders ? `'${folderPath(curFolder)}' 폴더에 만들기` : undefined}>
                  📄 문서
                </button>
                <button className="btn-outline px-2.5 py-1 text-xs" onClick={() => create("mindmap")}>
                  🧠 마인드맵
                </button>
                <button className="btn-outline px-1.5 py-1 text-xs" onClick={() => setNewMenu((v) => !v)} title="회의록·내 템플릿으로 만들기" aria-label="템플릿으로 만들기">
                  ▾
                </button>
                {newMenu && <NewNoteMenu templates={plus ? templates : []} meId={me?.id} isAdmin={!!me?.is_admin} onPick={pickNew} onDeleteTemplate={deleteTemplate} onClose={() => setNewMenu(false)} />}
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
                {plus && <option value="mentioned">@ 나를 언급한 메모</option>}
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
          {!noFolders && (
            <div className="flex items-center gap-1 border-b border-black/[0.06] px-3 py-1.5" data-tour="notes-view">
              <div className="inline-flex rounded-lg bg-black/[0.04] p-0.5 text-xs">
                {(["tree", "date"] as const).map((v) => (
                  <button key={v} onClick={() => setView(v)} className={`rounded-md px-2 py-0.5 ${view === v ? "bg-white font-medium shadow-sm" : "text-slate-500"}`}>
                    {v === "tree" ? "📁 폴더" : "🕒 날짜순"}
                  </button>
                ))}
              </div>
              {view === "tree" && <span className="ml-auto text-[10px] text-slate-400">끌어서 폴더로 옮기기</span>}
            </div>
          )}
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
            {!trashView && !filtering && !loading && (favList.length > 0 || recentList.length > 0) && (
              <div className="border-b border-black/[0.06] pb-1.5" data-tour="notes-favs">
                {[
                  { title: "⭐ 즐겨찾기", list: favList },
                  { title: "🕘 최근 본 메모", list: recentList },
                ]
                  .filter((g) => g.list.length)
                  .map((g) => (
                    <div key={g.title}>
                      <div className="px-3 pb-0.5 pt-2 text-[10px] font-medium text-slate-400">{g.title}</div>
                      {g.list.map((n) => (
                        <button
                          key={n.id}
                          onClick={() => go(n.id)}
                          onContextMenu={(e) => noteMenu(e, n)}
                          className={`flex w-full items-center gap-1.5 border-l-2 py-1 pl-5 pr-3 text-left text-sm ${n.id === selectedId ? "border-brand-500 bg-brand-500/[0.07] font-medium" : "border-transparent hover:bg-slate-50"}`}
                        >
                          <span className="text-xs">{n.icon || KIND_ICON[n.kind]}</span>
                          <span className={`min-w-0 flex-1 truncate ${n.title ? "" : "text-slate-400"}`}>{(n.id === selectedId && draft ? draft.title : n.title) || "제목 없음"}</span>
                        </button>
                      ))}
                    </div>
                  ))}
              </div>
            )}
            {trashView ? (
              <div data-tour="notes-trash-list">
                <div className="flex items-center gap-2 px-3 pb-1 pt-2 text-[11px] text-slate-500">
                  <button className="rounded px-1.5 py-0.5 hover:bg-slate-100" onClick={() => setTrashView(false)}>
                    ← 메모로
                  </button>
                  <span className="ml-auto text-slate-400">30일이 지나면 자동으로 지워져요</span>
                </div>
                {trash.length === 0 ? (
                  <p className="p-6 text-center text-sm text-slate-400">휴지통이 비어 있습니다.</p>
                ) : (
                  trash.map((n) => {
                    const left = Math.max(0, 30 - Math.floor((Date.now() - new Date(n.deleted_at as string).getTime()) / 86400000));
                    return (
                      <div key={n.id} className={`group flex items-center gap-1.5 px-3 py-1.5 text-sm ${n.id === selectedId ? "bg-brand-500/[0.07]" : "hover:bg-slate-50"}`} onContextMenu={(e) => noteMenu(e, n)}>
                        <button className="min-w-0 flex-1 truncate text-left" onClick={() => go(n.id)} title="눌러서 내용 보기">
                          <span className="mr-1 text-xs">{n.icon || KIND_ICON[n.kind]}</span>
                          {n.title || "제목 없음"}
                        </button>
                        <span className="shrink-0 text-[10px] text-slate-400 group-hover:hidden">{left}일 남음</span>
                        <button className="hidden shrink-0 rounded px-1 text-[11px] text-brand-600 hover:bg-brand-500/10 group-hover:block" onClick={() => restore(n.id)}>
                          되살리기
                        </button>
                        {(n.author_id === me?.id || me?.is_admin) && (
                          <button className="hidden shrink-0 rounded px-1 text-[11px] text-rose-600 hover:bg-rose-50 group-hover:block" onClick={() => destroy(n)}>
                            완전 삭제
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            ) : loading ? (
              <p className="p-6 text-center text-sm text-slate-400">불러오는 중…</p>
            ) : !noFolders && view === "tree" ? (
              <NoteTree
                folders={folders}
                notes={shown}
                filtering={filtering}
                selectedId={selectedId}
                curFolder={curFolder}
                meId={me?.id}
                isGamePart={!!me?.is_game_part}
                isAdmin={!!me?.is_admin}
                draft={draft}
                onOpen={(id) => go(id)}
                onSelectFolder={setCurFolder}
                onMoveNote={moveNote}
                onMoveFolder={(id, parent) => updateFolder(id, { parent_id: parent })}
                onCreateFolder={createFolder}
                onRename={(id, name) => updateFolder(id, { name })}
                onDelete={deleteFolder}
                onToggleVis={(f) => updateFolder(f.id, { visibility: f.visibility === "shared" ? "private" : "shared" })}
                onNewNote={(kind, folderId) => create(kind, undefined, folderId)}
                onNoteContext={noteMenu}
              />
            ) : shown.length === 0 ? (
              <p className="p-6 text-center text-sm text-slate-400">{live.length ? "조건에 맞는 메모가 없습니다." : "아직 메모가 없습니다. 위에서 새로 만들어 보세요."}</p>
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
                            onContextMenu={(e) => noteMenu(e, n)}
                            className={`block w-full border-l-2 px-3 py-2 text-left ${active ? "border-brand-500 bg-brand-500/[0.06]" : "border-transparent hover:bg-slate-50"}`}
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs">{view.icon || KIND_ICON[view.kind]}</span>
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
          {plus && !trashView && (
            <button className="flex shrink-0 items-center gap-1.5 border-t border-black/[0.06] px-3 py-2 text-xs text-slate-500 hover:bg-slate-50" onClick={openTrash} data-tour="notes-trash">
              🗑 휴지통
              {trash.length > 0 && <span className="rounded-full bg-slate-100 px-1.5 text-[10px]">{trash.length}</span>}
            </button>
          )}
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
            {plus && draft.cover && COVERS[draft.cover] && (
              <div className="group relative h-20 shrink-0" style={{ background: COVERS[draft.cover] }}>
                {canEdit && (
                  <button className="absolute bottom-2 right-3 hidden rounded-md bg-white/85 px-2 py-0.5 text-[11px] text-slate-700 shadow-sm hover:bg-white group-hover:block" onClick={() => setPop("cover")}>
                    커버 바꾸기
                  </button>
                )}
                {pop === "cover" && (
                  <div className="absolute bottom-0 right-3">
                    <CoverPicker value={draft.cover} onPick={(v) => change({ cover: v })} onClose={() => setPop(null)} />
                  </div>
                )}
              </div>
            )}
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
                {plus && (draft.icon || canEdit) && (
                  <div className="relative shrink-0" data-tour="notes-icon">
                    <button
                      className={`grid h-8 w-8 place-items-center rounded-md ${draft.icon ? "text-2xl" : "text-base opacity-30 hover:opacity-100"} ${canEdit ? "hover:bg-slate-100" : "cursor-default"}`}
                      onClick={() => canEdit && setPop(pop === "icon" ? null : "icon")}
                      title={canEdit ? (draft.icon ? "아이콘 바꾸기" : "아이콘 추가") : undefined}
                    >
                      {draft.icon || "😀"}
                    </button>
                    {pop === "icon" && <IconPicker value={draft.icon} onPick={(v) => change({ icon: v })} onClose={() => setPop(null)} />}
                  </div>
                )}
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
                  {draft.deleted_at ? "휴지통" : !canEdit ? "읽기 전용" : saveState === "saving" ? "저장 중…" : dirty ? "고치는 중" : saveState === "error" ? <span className="text-rose-600">저장 안 됨</span> : "저장됨"}
                </span>
                {plus && canEdit && !draft.cover && (
                  <div className="relative">
                    <Tip content="커버 추가">
                      <button className="btn-ghost px-1.5 py-0.5 text-sm opacity-50 hover:opacity-100" onClick={() => setPop(pop === "cover" ? null : "cover")}>
                        🎨
                      </button>
                    </Tip>
                    {pop === "cover" && <CoverPicker value={draft.cover} onPick={(v) => change({ cover: v })} onClose={() => setPop(null)} />}
                  </div>
                )}
                {plus && !draft.deleted_at && (
                  <Tip content={favs.has(draft.id) ? "즐겨찾기에서 빼기" : "즐겨찾기 (목록 위에 고정)"}>
                    <button className={`btn-ghost px-1.5 py-0.5 text-base ${favs.has(draft.id) ? "text-amber-500" : "text-slate-300 hover:text-amber-500"}`} onClick={() => toggleFav(draft.id)} data-tour="notes-fav">
                      {favs.has(draft.id) ? "★" : "☆"}
                    </button>
                  </Tip>
                )}
                {draft.kind === "doc" && (
                  <Tip content={toc ? "목차 닫기" : "목차 보기"}>
                    <button className={`btn-ghost hidden px-1.5 py-0.5 text-sm xl:block ${toc ? "text-ink" : "text-slate-400"}`} onClick={() => setToc(!toc)}>
                      ☰
                    </button>
                  </Tip>
                )}
                <NoteMenu
                  items={[
                    ...(plus ? [{ icon: "🕘", label: "버전 기록", run: () => setShowVersions(true) }] : []),
                    ...(plus && canEdit ? [{ icon: "📋", label: "템플릿으로 저장", run: saveAsTemplate }] : []),
                    ...(draft.kind === "doc"
                      ? [
                          { icon: "🖨️", label: "PDF로 저장 · 인쇄", run: () => exportPrint(draft.title, exportMeta(), draft.body_html ?? "") },
                          { icon: "⬇", label: "마크다운으로 받기 (.md)", run: () => exportMarkdown(draft.title, draft.body_html ?? "") },
                          { icon: "⬇", label: "Word로 받기 (.doc)", run: () => exportWord(draft.title, exportMeta(), draft.body_html ?? "") },
                        ]
                      : [
                          {
                            icon: "🖼️",
                            label: "이미지로 저장 (PNG)",
                            run: async () => {
                              const blob = await mapRef.current?.exportPng();
                              if (!blob) return;
                              const a = document.createElement("a");
                              a.href = URL.createObjectURL(blob);
                              a.download = `${draft.title || "마인드맵"}.png`;
                              a.click();
                              setTimeout(() => URL.revokeObjectURL(a.href), 2000);
                            },
                          },
                          { icon: "⬇", label: "개요를 마크다운으로 (.md)", run: () => exportMarkdownText(draft.title, mindmapText(draft.mindmap).replace(/^( *)/gm, (m) => m + "- ")) },
                          {
                            icon: "📄",
                            label: "개요를 새 문서로",
                            run: async () => {
                              const html = mapRef.current?.outlineHtml();
                              if (!html) return;
                              const { data } = await supabase()
                                .from("notes")
                                .insert({ kind: "doc", title: `${draft.title || "마인드맵"} (개요)`, category: draft.category, body_html: html, body_text: htmlToText(html), project_id: draft.project_id, stage_ids: draft.stage_ids, visibility: draft.visibility, note_date: draft.note_date, ...(noFolders ? {} : { folder_id: draft.folder_id ?? null }) })
                                .select("id")
                                .single();
                              if (data) go((data as { id: string }).id);
                            },
                          },
                        ]),
                    ...((plus ? canEdit : isAuthor || !!me?.is_admin) ? [{ icon: "🗑", label: plus ? "휴지통으로 옮기기" : "메모 지우기", danger: true, run: remove }] : []),
                  ]}
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

              {!noFolders && (
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-slate-400">폴더</span>
                  <select
                    className="max-w-[320px] rounded-md border border-black/10 bg-white px-1.5 py-0.5 text-xs disabled:opacity-70"
                    value={draft.folder_id ?? ""}
                    disabled={!canEdit}
                    onChange={(e) => change({ folder_id: e.target.value || null })}
                  >
                    <option value="">— 폴더 밖 —</option>
                    {folderOptions.map(({ f, depth }) => (
                      <option key={f.id} value={f.id}>
                        {"\u00a0\u00a0".repeat(depth)}
                        {depth ? "└ " : ""}
                        {f.name}
                        {f.visibility === "private" ? " 🔒" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}

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

            {draft.deleted_at && (
              <div className="flex flex-wrap items-center gap-2 border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-900">
                <span>🗑 휴지통에 있는 메모입니다. 30일이 지나면 자동으로 지워져요.</span>
                <button className="btn-outline ml-auto bg-white py-0.5 text-xs" onClick={() => restore(draft.id)}>
                  되살리기
                </button>
                {(isAuthor || me?.is_admin) && (
                  <button className="rounded-md px-2 py-0.5 text-rose-700 hover:bg-rose-100" onClick={() => destroy(draft)}>
                    완전 삭제
                  </button>
                )}
              </div>
            )}

            {/* 본문 */}
            <div className="npd-note-body flex min-h-0 flex-1 flex-col">
              {draft.kind === "doc" ? (
                <div className="flex min-h-0 flex-1">
                <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-3">
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
                      blocks
                      minHeight={400}
                      placeholder="자유롭게 적어보세요. ' / ' 로 제목·토글·표·이미지 넣기 · 자동 저장"
                    />
                  </div>
                </div>
                {toc && <Toc html={draft.body_html} onClose={() => setToc(false)} />}
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
              {plus && <Backlinks key={draft.id} noteId={draft.id} onOpen={(id) => go(id)} />}
            </div>
          </>
        )}
      </section>

      {showVersions && draft && (
        <VersionsModal
          note={draft}
          current={{ title: draft.title, body_html: draft.body_html, mindmap: draft.mindmap }}
          canRestore={canEdit}
          profileById={profileById}
          onRestore={(v: NoteVersion) => {
            change({ title: v.title ?? draft.title, body_html: v.body_html, mindmap: v.mindmap });
            setRk((k) => k + 1);
            say("예전 버전으로 되돌렸습니다");
          }}
          onClose={() => setShowVersions(false)}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-3 rounded-xl bg-ink px-4 py-2.5 text-sm text-white shadow-xl">
          <span>{toast.text}</span>
          {toast.action && (
            <button
              className="rounded-md bg-white/15 px-2 py-0.5 text-xs font-medium hover:bg-white/25"
              onClick={() => {
                toast.action?.run();
                setToast(null);
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button className="text-white/60 hover:text-white" onClick={() => setToast(null)} aria-label="닫기">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

// ---- ⋯ 메뉴 ---------------------------------------------------------------
type MenuItem = { icon: string; label: string; run: () => void; danger?: boolean };
function NoteMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [open]);
  if (!items.length) return null;
  return (
    <div className="relative" ref={ref} data-tour="notes-menu">
      <button className="btn-ghost px-2 py-0.5" onClick={() => setOpen((v) => !v)} aria-label="더보기">
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-lg border border-black/10 bg-white py-1 text-sm shadow-lg">
          {items.map((it, i) => (
            <div key={it.label}>
              {it.danger && i > 0 && <div className="my-1 border-t border-black/[0.06]" />}
              <button className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${it.danger ? "text-rose-600 hover:bg-rose-50" : "hover:bg-slate-50"}`} onClick={() => (setOpen(false), it.run())}>
                <span className="w-5 text-center">{it.icon}</span>
                {it.label}
              </button>
            </div>
          ))}
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
