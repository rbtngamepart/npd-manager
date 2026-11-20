"use client";

// 메모 화면 부품: 아이콘·커버 · 목차 · 버전 기록 · 이 메모를 가리키는 메모 · 새 메모(템플릿) 메뉴
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { displayName } from "@/components/AppProvider";
import { RichView } from "@/components/RichText";
import { mindmapText } from "@/components/MindMap";
import type { Note, NoteKind, NoteVersion, Profile } from "@/lib/types";

// ---- 아이콘 · 커버 ----------------------------------------------------------
export const NOTE_EMOJIS = [
  "📝", "📄", "📌", "📎", "🗂️", "📁", "📅", "🗓️", "✅", "☑️", "⭐", "🌟", "💡", "🧠", "🎯", "🚀",
  "🔥", "⚡", "❗", "❓", "⚠️", "🛠️", "🔧", "🧩", "🎲", "♟️", "🃏", "🎮", "🏆", "🎉", "🎁", "📣",
  "💬", "👥", "🤝", "🙋", "👀", "📊", "📈", "💰", "🧾", "🏪", "🌏", "✈️", "🚚", "📦", "🏷️", "🖼️",
  "🎨", "✏️", "🔍", "🧪", "📚", "🗒️", "🔒", "🔑", "❤️", "🍀", "☕", "🍕", "🐶", "🌈",
];

export const COVERS: Record<string, string> = {
  sunset: "linear-gradient(135deg,#fde68a 0%,#fca5a5 100%)",
  ocean: "linear-gradient(135deg,#bae6fd 0%,#a5b4fc 100%)",
  forest: "linear-gradient(135deg,#bbf7d0 0%,#5eead4 100%)",
  grape: "linear-gradient(135deg,#e9d5ff 0%,#f0abfc 100%)",
  brand: "linear-gradient(135deg,#fecaca 0%,#f87171 100%)",
  sand: "linear-gradient(135deg,#fef3c7 0%,#fdba74 100%)",
  slate: "linear-gradient(135deg,#e2e8f0 0%,#94a3b8 100%)",
  night: "linear-gradient(135deg,#334155 0%,#0f172a 100%)",
};

function usePop(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", off);
    window.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", off);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  return ref;
}

export function IconPicker({ value, onPick, onClose }: { value: string | null | undefined; onPick: (v: string | null) => void; onClose: () => void }) {
  const ref = usePop(onClose);
  return (
    <div ref={ref} className="absolute left-0 top-full z-40 mt-1 w-[300px] rounded-xl border border-black/10 bg-white p-2 shadow-xl">
      <div className="mb-1 flex items-center px-1 text-[11px] text-slate-400">
        아이콘
        {value && (
          <button className="ml-auto rounded px-1.5 py-0.5 hover:bg-slate-100" onClick={() => (onPick(null), onClose())}>
            지우기
          </button>
        )}
      </div>
      <div className="grid grid-cols-8 gap-0.5">
        {NOTE_EMOJIS.map((e) => (
          <button key={e} className={`grid h-8 w-8 place-items-center rounded text-lg hover:bg-slate-100 ${value === e ? "bg-slate-100 ring-1 ring-black/10" : ""}`} onClick={() => (onPick(e), onClose())}>
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

export function CoverPicker({ value, onPick, onClose }: { value: string | null | undefined; onPick: (v: string | null) => void; onClose: () => void }) {
  const ref = usePop(onClose);
  return (
    <div ref={ref} className="absolute right-0 top-full z-40 mt-1 w-[260px] rounded-xl border border-black/10 bg-white p-2 shadow-xl">
      <div className="mb-1.5 flex items-center px-1 text-[11px] text-slate-400">
        커버
        {value && (
          <button className="ml-auto rounded px-1.5 py-0.5 hover:bg-slate-100" onClick={() => (onPick(null), onClose())}>
            지우기
          </button>
        )}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {Object.entries(COVERS).map(([k, bg]) => (
          <button key={k} className={`h-10 rounded-md ring-offset-1 hover:ring-2 hover:ring-black/20 ${value === k ? "ring-2 ring-brand-500" : ""}`} style={{ background: bg }} onClick={() => (onPick(k), onClose())} aria-label={k} />
        ))}
      </div>
    </div>
  );
}

// ---- 목차 ------------------------------------------------------------------
export function headingsOf(html: string | null | undefined): { level: number; text: string }[] {
  if (!html || typeof window === "undefined") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.querySelectorAll("h1,h2,h3"))
    .map((h) => ({ level: Number(h.tagName[1]), text: (h.textContent ?? "").trim() }))
    .filter((h) => h.text);
}

export function Toc({ html, onClose }: { html: string | null | undefined; onClose: () => void }) {
  const items = useMemo(() => headingsOf(html), [html]);
  const jump = (i: number) => {
    const all = Array.from(document.querySelectorAll<HTMLElement>(".npd-note-body .ProseMirror h1, .npd-note-body .ProseMirror h2, .npd-note-body .ProseMirror h3")).filter((h) => (h.textContent ?? "").trim());
    all[i]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const min = Math.min(...items.map((x) => x.level), 3);
  return (
    <aside className="hidden w-52 shrink-0 border-l border-black/[0.06] xl:block" data-tour="notes-toc">
      <div className="flex items-center px-3 pb-1 pt-3 text-[11px] font-medium text-slate-400">
        목차
        <button className="ml-auto rounded px-1 hover:bg-slate-100" onClick={onClose} aria-label="목차 닫기">
          ✕
        </button>
      </div>
      {items.length === 0 ? (
        <p className="px-3 py-2 text-[11px] leading-relaxed text-slate-400">
          제목(<code>#</code>, <code>##</code>, <code>###</code> 또는 <code>/제목</code>)을 쓰면 여기에 목차가 생겨요.
        </p>
      ) : (
        <ul className="scroll-thin max-h-[calc(100%-2rem)] overflow-y-auto px-1.5 pb-3">
          {items.map((h, i) => (
            <li key={i}>
              <button className="block w-full truncate rounded px-2 py-1 text-left text-xs text-slate-600 hover:bg-slate-50 hover:text-ink" style={{ paddingLeft: 8 + (h.level - min) * 12 }} onClick={() => jump(i)} title={h.text}>
                {h.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

// ---- 버전 기록 ---------------------------------------------------------------
export function VersionsModal({
  note,
  current,
  canRestore,
  profileById,
  onRestore,
  onClose,
}: {
  note: Pick<Note, "id" | "kind" | "title">;
  current: { title: string; body_html: string | null; mindmap: unknown };
  canRestore: boolean;
  profileById: Record<string, Profile>;
  onRestore: (v: NoteVersion) => void;
  onClose: () => void;
}) {
  const [list, setList] = useState<NoteVersion[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    supabase()
      .from("note_versions")
      .select("*")
      .eq("note_id", note.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        const l = (data ?? []) as NoteVersion[];
        setList(l);
        setSel(l[0]?.id ?? null);
      });
  }, [note.id]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, [onClose]);
  const v = list?.find((x) => x.id === sel);
  const fmt = (s: string) => new Date(s).toLocaleString("ko-KR", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex h-[min(760px,90vh)] w-[min(1000px,100%)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" role="dialog" aria-label="버전 기록">
        <div className="flex items-center gap-2 border-b border-black/[0.06] px-5 py-3">
          <span className="text-sm font-semibold">버전 기록</span>
          <span className="truncate text-xs text-slate-400">· {note.title || "제목 없음"}</span>
          <button className="btn-ghost ml-auto px-2" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        <div className="flex min-h-0 flex-1">
          <ul className="scroll-thin w-56 shrink-0 overflow-y-auto border-r border-black/[0.06] p-1.5 text-sm">
            <li className="px-2 pb-1 pt-1 text-[11px] text-slate-400">고치기 시작할 때(10분 넘게 쉬었다가) 직전 내용이 자동으로 남아요. 최근 50개.</li>
            {list === null ? (
              <li className="px-2 py-3 text-xs text-slate-400">불러오는 중…</li>
            ) : list.length === 0 ? (
              <li className="px-2 py-3 text-xs text-slate-400">아직 남은 버전이 없습니다.</li>
            ) : (
              list.map((x) => (
                <li key={x.id}>
                  <button className={`block w-full rounded-md px-2 py-1.5 text-left ${sel === x.id ? "bg-brand-500/[0.08] text-ink" : "hover:bg-slate-50"}`} onClick={() => setSel(x.id)}>
                    <div className="text-[13px] font-medium">{fmt(x.created_at)}</div>
                    <div className="truncate text-[11px] text-slate-400">{x.created_by ? displayName(profileById[x.created_by]) : "—"}</div>
                  </button>
                </li>
              ))
            )}
          </ul>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-6 py-4">
              {v ? (
                <>
                  <h2 className="mb-3 text-xl font-semibold">{v.title || "제목 없음"}</h2>
                  {note.kind === "mindmap" ? (
                    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-700">{mindmapText(v.mindmap) || "(빈 마인드맵)"}</pre>
                  ) : (
                    <RichView html={v.body_html} className="text-[15px]!" />
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-400">왼쪽에서 버전을 고르세요.</p>
              )}
            </div>
            {v && (
              <div className="flex items-center justify-end gap-2 border-t border-black/[0.06] px-5 py-3">
                <span className="mr-auto text-[11px] text-slate-400">되돌려도 지금 내용은 버전으로 남아서 다시 돌아올 수 있어요.</span>
                <button className="btn-ghost text-sm" onClick={onClose}>
                  닫기
                </button>
                <button
                  className="btn-primary text-sm"
                  disabled={!canRestore}
                  title={canRestore ? undefined : "이 메모를 고칠 권한이 없습니다"}
                  onClick={async () => {
                    // 지금 내용을 먼저 버전으로 남김
                    await supabase().from("note_versions").insert({ note_id: note.id, title: current.title, kind: note.kind, body_html: current.body_html, mindmap: current.mindmap });
                    onRestore(v);
                    onClose();
                  }}
                >
                  이 버전으로 되돌리기
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- 이 메모를 가리키는 메모 ---------------------------------------------------
export function Backlinks({ noteId, onOpen }: { noteId: string; onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<Pick<Note, "id" | "title" | "icon" | "kind">[]>([]);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    let dead = false;
    supabase()
      .from("notes")
      .select("id,title,icon,kind,deleted_at,is_template")
      .contains("ref_note_ids", [noteId])
      .then(({ data, error }) => {
        if (dead || error) return;
        setRows(((data ?? []) as (Note & { deleted_at: string | null })[]).filter((n) => !n.deleted_at && !n.is_template));
      });
    return () => {
      dead = true;
    };
  }, [noteId]);
  if (!rows.length) return null;
  return (
    <div className="border-t border-black/[0.06] px-4 py-2 text-xs" data-tour="notes-backlinks">
      <button className="flex items-center gap-1 text-slate-500 hover:text-ink" onClick={() => setOpen((v) => !v)}>
        {open ? "▾" : "▸"} 이 메모를 가리키는 메모 {rows.length}
      </button>
      {open && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {rows.map((n) => (
            <button key={n.id} className="rounded-md bg-slate-100 px-2 py-0.5 text-slate-700 hover:bg-slate-200" onClick={() => onOpen(n.id)}>
              {n.icon || (n.kind === "mindmap" ? "🧠" : "📄")} {n.title || "제목 없음"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- 새 메모 메뉴 (빈 문서 · 회의록 · 마인드맵 · 내 템플릿) ------------------------
export type NewChoice = { kind: NoteKind; preset?: "meeting" } | { template: Note };

export function NewNoteMenu({
  templates,
  meId,
  isAdmin,
  onPick,
  onDeleteTemplate,
  onClose,
}: {
  templates: Note[];
  meId: string | undefined;
  isAdmin: boolean;
  onPick: (c: NewChoice) => void;
  onDeleteTemplate: (t: Note) => void;
  onClose: () => void;
}) {
  const ref = usePop(onClose);
  const pick = (c: NewChoice) => {
    onClose();
    onPick(c);
  };
  const Item = ({ icon, label, hint, onClick }: { icon: string; label: string; hint?: string; onClick: () => void }) => (
    <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50" onClick={onClick}>
      <span className="w-5 text-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
    </button>
  );
  return (
    <div ref={ref} className="absolute right-0 top-full z-40 mt-1 w-64 rounded-xl border border-black/10 bg-white p-1.5 shadow-xl" data-tour="notes-templates">
      <Item icon="📄" label="빈 문서" onClick={() => pick({ kind: "doc" })} />
      <Item icon="👥" label="회의록" hint="참석자·안건·결정·할 일" onClick={() => pick({ kind: "doc", preset: "meeting" })} />
      <Item icon="🧠" label="빈 마인드맵" onClick={() => pick({ kind: "mindmap" })} />
      <div className="mx-2 my-1 border-t border-black/[0.06]" />
      <div className="px-2 pb-0.5 pt-1 text-[11px] text-slate-400">내 템플릿</div>
      {templates.length === 0 ? (
        <p className="px-2 pb-1.5 text-[11px] leading-relaxed text-slate-400">메모의 ⋯ 메뉴 → [템플릿으로 저장]으로 자주 쓰는 형식을 추가해 보세요.</p>
      ) : (
        templates.map((t) => (
          <div key={t.id} className="group flex items-center">
            <Item icon={t.icon || (t.kind === "mindmap" ? "🧠" : "📋")} label={t.title || "제목 없는 템플릿"} hint={t.visibility === "private" ? "🔒" : undefined} onClick={() => pick({ template: t })} />
            {(t.author_id === meId || isAdmin) && (
              <button
                className="mr-1 hidden rounded px-1.5 text-xs text-slate-400 hover:bg-rose-50 hover:text-rose-600 group-hover:block"
                title="템플릿 지우기"
                onClick={() => onDeleteTemplate(t)}
              >
                ✕
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );
}
