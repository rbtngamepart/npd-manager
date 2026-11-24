"use client";

// 메모 폴더 트리: 폴더 안에 폴더, 메모를 끌어서 폴더로, 폴더를 끌어서 다른 폴더 안으로
import { useEffect, useMemo, useRef, useState } from "react";
import type { Note, NoteFolder, NoteKind } from "@/lib/types";
import { useContextMenu } from "./ContextMenu";

const KIND_ICON: Record<NoteKind, string> = { doc: "📄", mindmap: "🧠" };
const OPEN_KEY = "npd-note-open-folders";

type Drag = { type: "note" | "folder"; id: string } | null;

export interface NoteTreeProps {
  folders: NoteFolder[];
  /** 필터·검색을 거친 메모 */
  notes: Note[];
  /** 필터·검색 중이면 맞는 메모가 있는 폴더만, 모두 펼쳐서 */
  filtering: boolean;
  selectedId: string | null;
  curFolder: string | null;
  meId: string | undefined;
  isGamePart: boolean;
  isAdmin: boolean;
  /** 열린 메모의 고치는 중인 제목 등 */
  draft: Note | null;
  onOpen: (id: string) => void;
  onSelectFolder: (id: string | null) => void;
  onMoveNote: (noteId: string, folderId: string | null) => void;
  onMoveFolder: (id: string, parentId: string | null) => void;
  onCreateFolder: (parentId: string | null) => Promise<string | undefined>;
  onRename: (id: string, name: string) => void;
  onDelete: (f: NoteFolder) => void;
  onToggleVis: (f: NoteFolder) => void;
  onNewNote: (kind: NoteKind, folderId: string | null) => void;
  /** 메모 오른쪽 클릭 */
  onNoteContext?: (e: React.MouseEvent, n: Note) => void;
}

export function NoteTree(p: NoteTreeProps) {
  const { folders, notes, filtering, selectedId, curFolder, draft } = p;
  const [open, setOpen] = useState<Set<string>>(new Set());
  const open_ = open;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [over, setOver] = useState<string | null>(null); // 폴더 id 또는 "root"

  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]");
      if (Array.isArray(v)) setOpen(new Set(v));
    } catch {
      /* 무시 */
    }
  }, []);
  const saveOpen = (s: Set<string>) => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify([...s]));
    } catch {
      /* 무시 */
    }
  };
  const setFolderOpen = (id: string, on: boolean) =>
    setOpen((cur) => {
      const n = new Set(cur);
      if (on) n.add(id);
      else n.delete(id);
      saveOpen(n);
      return n;
    });

  const byId = useMemo(() => Object.fromEntries(folders.map((f) => [f.id, f])), [folders]);
  // 부모가 안 보이는(남의 나만 보기 폴더 등) 폴더·메모는 맨 위로
  const parentOf = (f: NoteFolder) => (f.parent_id && byId[f.parent_id] ? f.parent_id : null);
  const folderOf = (n: Note) => (n.folder_id && byId[n.folder_id] ? n.folder_id : null);

  const kids = useMemo(() => {
    const m: Record<string, NoteFolder[]> = {};
    folders.forEach((f) => (m[parentOf(f) ?? "root"] ??= []).push(f));
    Object.values(m).forEach((l) => l.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ko", { numeric: true })));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders, byId]);
  const notesIn = useMemo(() => {
    const m: Record<string, Note[]> = {};
    notes.forEach((n) => (m[folderOf(n) ?? "root"] ??= []).push(n));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, byId]);
  // 폴더 아래(하위 폴더 포함) 메모 수
  const count = useMemo(() => {
    const c: Record<string, number> = {};
    const walk = (id: string): number => {
      if (c[id] !== undefined) return c[id];
      c[id] = 0; // 꼬인 데이터 대비
      c[id] = (notesIn[id]?.length ?? 0) + (kids[id] ?? []).reduce((a, f) => a + walk(f.id), 0);
      return c[id];
    };
    folders.forEach((f) => walk(f.id));
    return c;
  }, [folders, notesIn, kids]);

  // 열린 메모·고른 폴더가 있는 곳은 펼쳐 두기
  useEffect(() => {
    const target = draft?.folder_id ?? curFolder;
    if (!target) return;
    const up: string[] = [];
    let cur: string | null = byId[target]?.parent_id ?? null;
    let guard = 0;
    while (cur && byId[cur] && guard++ < 100) {
      up.push(cur);
      cur = byId[cur].parent_id;
    }
    if (up.some((id) => !open.has(id))) {
      const n = new Set(open);
      up.forEach((id) => n.add(id));
      setOpen(n);
      saveOpen(n);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.folder_id, curFolder, byId]);

  const canEdit = (f: NoteFolder) => f.owner_id === p.meId || (f.visibility === "shared" && p.isGamePart);
  const canDelete = (f: NoteFolder) => canEdit(f) || p.isAdmin;
  const isInside = (id: string, ancestor: string) => {
    let cur: string | null = id;
    let guard = 0;
    while (cur && guard++ < 200) {
      if (cur === ancestor) return true;
      cur = byId[cur]?.parent_id ?? null;
    }
    return false;
  };
  const canDrop = (target: string | null) => {
    if (!drag) return false;
    if (drag.type === "folder") {
      if (target && isInside(target, drag.id)) return false;
      return parentOf(byId[drag.id]) !== target;
    }
    const n = notes.find((x) => x.id === drag.id);
    return (n ? folderOf(n) : null) !== target;
  };
  const drop = (target: string | null) => {
    if (!drag || !canDrop(target)) return;
    if (drag.type === "note") p.onMoveNote(drag.id, target);
    else p.onMoveFolder(drag.id, target);
    if (target) setFolderOpen(target, true);
    setDrag(null);
    setOver(null);
  };

  async function newFolder(parent: string | null) {
    setMenu(null);
    const id = await p.onCreateFolder(parent);
    if (parent) setFolderOpen(parent, true);
    if (id) setRenaming(id);
  }

  const openMenu = useContextMenu();
  const folderItems = (f: NoteFolder) => {
    const edit = canEdit(f);
    return [
      { label: "📄 이 폴더에 새 문서", run: () => p.onNewNote("doc", f.id) },
      { label: "🧠 이 폴더에 새 마인드맵", run: () => p.onNewNote("mindmap", f.id) },
      { label: "📁 하위 폴더 만들기", run: () => newFolder(f.id) },
      ...(edit ? [{ label: "✏️ 이름 바꾸기", run: () => setRenaming(f.id) }] : []),
      ...(f.owner_id === p.meId ? [{ label: f.visibility === "shared" ? "🔒 나만 보기로" : "👥 팀 공개로", run: () => p.onToggleVis(f) }] : []),
      ...(edit && parentOf(f) ? [{ label: "⤴ 맨 위로 꺼내기", run: () => p.onMoveFolder(f.id, null) }] : []),
      ...(canDelete(f) ? [{ label: "폴더 지우기", danger: true, run: () => p.onDelete(f) }] : []),
    ];
  };
  const folderContext = (e: React.MouseEvent, f: NoteFolder) => {
    const items = folderItems(f);
    const open = filtering || open_.has(f.id);
    openMenu(e, [
      { header: f.name },
      { icon: open ? "▾" : "▸", label: open ? "접기" : "펼치기", run: () => setFolderOpen(f.id, !open) },
      "sep",
      ...items.map((it, i) => {
        // "📄 이 폴더에 새 문서" → 아이콘과 글자 나누기
        const m = /^(\S+)\s(.+)$/u.exec(it.label);
        const item = { icon: m && !/^[가-힣A-Za-z]/.test(m[1]) ? m[1] : undefined, label: m && !/^[가-힣A-Za-z]/.test(m[1]) ? m[2] : it.label, danger: "danger" in it ? it.danger : undefined, run: it.run };
        return it.label === "폴더 지우기" && i > 0 ? [("sep" as const), { ...item, icon: "🗑" }] : [item];
      }).flat(),
    ]);
  };

  const rows: React.ReactNode[] = [];
  const pad = (d: number) => 8 + d * 14;

  const noteRow = (n: Note, depth: number) => {
    const view = n.id === selectedId && draft ? { ...n, ...draft } : n;
    const active = n.id === selectedId;
    return (
      <div
        key={n.id}
        data-note-id={n.id}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", n.id);
          e.dataTransfer.effectAllowed = "move";
          setDrag({ type: "note", id: n.id });
        }}
        onDragEnd={() => (setDrag(null), setOver(null))}
        onClick={() => p.onOpen(n.id)}
        onContextMenu={p.onNoteContext ? (e) => p.onNoteContext!(e, n) : undefined}
        className={`group flex cursor-pointer items-center gap-1.5 border-l-2 py-1 pr-2 text-sm ${active ? "border-brand-500 bg-brand-500/[0.07]" : "border-transparent hover:bg-slate-50"} ${drag?.id === n.id ? "opacity-40" : ""}`}
        style={{ paddingLeft: pad(depth) + 18 }}
        title={view.title || "제목 없음"}
      >
        <span className="text-xs">{view.icon || KIND_ICON[view.kind]}</span>
        <span className={`min-w-0 flex-1 truncate ${view.title ? "" : "text-slate-400"} ${active ? "font-medium" : ""}`}>{view.title || "제목 없음"}</span>
        {view.visibility === "private" && <span className="text-[10px]">🔒</span>}
        <span className="shrink-0 text-[10px] tabular-nums text-slate-400">{view.note_date.slice(5).replace("-", "/")}</span>
      </div>
    );
  };

  const folderRow = (f: NoteFolder, depth: number) => {
    const c = count[f.id] ?? 0;
    if (filtering && c === 0) return;
    const isOpen = filtering || open.has(f.id);
    const sel = curFolder === f.id;
    const edit = canEdit(f);
    rows.push(
      <div
        key={f.id}
        draggable={edit && renaming !== f.id}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", f.id);
          e.dataTransfer.effectAllowed = "move";
          setDrag({ type: "folder", id: f.id });
        }}
        onDragEnd={() => (setDrag(null), setOver(null))}
        onDragOver={(e) => {
          if (!canDrop(f.id)) return;
          e.preventDefault();
          e.stopPropagation();
          setOver(f.id);
        }}
        onDragLeave={() => over === f.id && setOver(null)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          drop(f.id);
        }}
        onClick={() => {
          if (renaming === f.id) return;
          p.onSelectFolder(f.id);
          if (!filtering) setFolderOpen(f.id, !open.has(f.id));
        }}
        onDoubleClick={() => edit && setRenaming(f.id)}
        onContextMenu={(e) => folderContext(e, f)}
        className={`group relative flex cursor-pointer select-none items-center gap-1 py-1 pr-1.5 text-sm ${over === f.id ? "bg-brand-500/15 ring-1 ring-inset ring-brand-500" : sel ? "bg-slate-100" : "hover:bg-slate-50"} ${drag?.id === f.id ? "opacity-40" : ""}`}
        style={{ paddingLeft: pad(depth) }}
      >
        <span className="w-3.5 shrink-0 text-center text-[9px] text-slate-400">{(kids[f.id]?.length || notesIn[f.id]?.length) ? (isOpen ? "▾" : "▸") : ""}</span>
        <span className="text-sm">{isOpen ? "📂" : "📁"}</span>
        {renaming === f.id ? (
          <input
            autoFocus
            defaultValue={f.name}
            className="min-w-0 flex-1 rounded border border-brand-500 bg-white px-1 py-0 text-sm outline-none"
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setRenaming(null);
            }}
            onBlur={(e) => {
              const v = e.currentTarget.value.trim();
              if (renaming === f.id && v && v !== f.name) p.onRename(f.id, v);
              setRenaming(null);
            }}
          />
        ) : (
          <span className={`min-w-0 flex-1 truncate ${sel ? "font-medium" : ""}`}>{f.name}</span>
        )}
        {f.visibility === "private" && <span className="text-[10px]" title="나만 보기 폴더">🔒</span>}
        <span className="shrink-0 text-[10px] tabular-nums text-slate-400 group-hover:hidden">{c || ""}</span>
        <button
          className={`shrink-0 rounded px-1 text-xs text-slate-500 hover:bg-black/[0.07] ${menu === f.id ? "block" : "hidden group-hover:block"}`}
          onClick={(e) => {
            e.stopPropagation();
            setMenu(menu === f.id ? null : f.id);
          }}
          aria-label="폴더 메뉴"
        >
          ⋯
        </button>
        {menu === f.id && (
          <FolderMenu
            onClose={() => setMenu(null)}
            items={folderItems(f)}
          />
        )}
      </div>
    );
    if (isOpen) {
      (kids[f.id] ?? []).forEach((k) => folderRow(k, depth + 1));
      (notesIn[f.id] ?? []).forEach((n) => rows.push(noteRow(n, depth + 1)));
    }
  };

  (kids.root ?? []).forEach((f) => folderRow(f, 0));
  const rootNotes = notesIn.root ?? [];
  const anyFolder = rows.length > 0;
  if (rootNotes.length) {
    if (anyFolder)
      rows.push(
        <div key="__root_head" className="px-3 pb-0.5 pt-2.5 text-[10px] font-medium text-slate-400">
          폴더 밖
        </div>
      );
    rootNotes.forEach((n) => rows.push(noteRow(n, 0)));
  }

  return (
    <div
      className={`min-h-full pb-10 ${over === "root" ? "bg-brand-500/[0.06]" : ""}`}
      onDragOver={(e) => {
        if (!canDrop(null)) return;
        e.preventDefault();
        setOver("root");
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target && over === "root") setOver(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        drop(null);
      }}
      onClick={(e) => e.target === e.currentTarget && p.onSelectFolder(null)}
    >
      <div className="flex items-center gap-1 px-3 pb-1 pt-2 text-[11px] text-slate-400" onClick={() => p.onSelectFolder(null)}>
        <span className={`cursor-pointer ${curFolder === null ? "font-medium text-slate-600" : "hover:text-slate-600"}`}>전체</span>
        <button className="ml-auto rounded px-1.5 py-0.5 text-slate-500 hover:bg-black/[0.05] hover:text-ink" onClick={(e) => (e.stopPropagation(), newFolder(curFolder))} title={curFolder ? "고른 폴더 안에 새 폴더" : "새 폴더"}>
          + 폴더
        </button>
      </div>
      {rows.length ? rows : <p className="p-6 text-center text-sm text-slate-400">{filtering ? "조건에 맞는 메모가 없습니다." : "아직 메모가 없습니다. 위에서 새로 만들어 보세요."}</p>}
      {drag && <p className="px-3 pt-3 text-center text-[11px] text-slate-400">폴더 위에 놓으면 그 안으로, 빈 곳에 놓으면 폴더 밖으로</p>}
    </div>
  );
}

function FolderMenu({ items, onClose }: { items: { label: string; run: () => void; danger?: boolean }[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [onClose]);
  return (
    <div ref={ref} className="absolute right-1 top-full z-30 mt-0.5 w-48 overflow-hidden rounded-lg border border-black/10 bg-white py-1 text-sm shadow-lg" onClick={(e) => e.stopPropagation()}>
      {items.map((it) => (
        <button
          key={it.label}
          className={`block w-full px-3 py-1.5 text-left ${it.danger ? "text-rose-600 hover:bg-rose-50" : "hover:bg-slate-50"}`}
          onClick={() => {
            onClose();
            it.run();
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
