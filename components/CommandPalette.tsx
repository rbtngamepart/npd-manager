"use client";

// Ctrl+K (맥은 ⌘K): 메모·프로젝트·단계·화면을 찾아서 바로 이동
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

interface Item {
  key: string;
  group: string;
  icon: string;
  label: string;
  hint?: string;
  href: string;
}

const CHO = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
/** 한글 초성만 뽑기: '브랜드실' → 'ㅂㄹㄷㅅ' (초성으로도 찾게) */
function chosung(s: string) {
  let out = "";
  for (const ch of s) {
    const c = ch.charCodeAt(0) - 0xac00;
    out += c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch;
  }
  return out;
}
const isChoOnly = (q: string) => /^[ㄱ-ㅎ\s]+$/.test(q);

export function CommandPalette({ pages }: { pages: { href: string; label: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const [data, setData] = useState<Item[] | null>(null);
  const loadedAt = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (data && Date.now() - loadedAt.current < 60_000) return;
    const sb = supabase();
    const notesQ = async () => {
      const r = await sb.from("notes").select("id,title,icon,kind,deleted_at,is_template").order("updated_at", { ascending: false }).limit(800);
      if (!r.error) return ((r.data ?? []) as { id: string; title: string; icon: string | null; kind: string; deleted_at: string | null; is_template: boolean }[]).filter((n) => !n.deleted_at && !n.is_template);
      const r2 = await sb.from("notes").select("id,title,kind").order("updated_at", { ascending: false }).limit(800);
      return ((r2.data ?? []) as { id: string; title: string; kind: string }[]).map((n) => ({ ...n, icon: null }));
    };
    const [notes, pj, st] = await Promise.all([notesQ(), sb.from("projects").select("id,name,archived").order("created_at", { ascending: false }), sb.from("stages").select("id,name,project_id,ref_code").order("sort_order")]);
    const projects = (pj.data ?? []) as { id: string; name: string; archived: boolean }[];
    const pname = Object.fromEntries(projects.map((p) => [p.id, p.name]));
    loadedAt.current = Date.now();
    setData([
      ...notes.map((n) => ({ key: `n:${n.id}`, group: "메모", icon: n.icon || (n.kind === "mindmap" ? "🧠" : "📄"), label: n.title || "제목 없음", href: `/notes?id=${n.id}` })),
      ...projects.map((p) => ({ key: `p:${p.id}`, group: "프로젝트", icon: "📁", label: p.name, hint: p.archived ? "보관" : undefined, href: `/projects/${p.id}` })),
      ...((st.data ?? []) as { id: string; name: string; project_id: string; ref_code: string | null }[]).map((s) => ({
        key: `s:${s.id}`,
        group: "단계",
        icon: "◆",
        label: s.name,
        hint: [pname[s.project_id], s.ref_code].filter(Boolean).join(" · "),
        href: `/projects/${s.project_id}?stage=${s.id}`,
      })),
    ]);
  }, [data]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopPropagation();
        setOpen((v) => !v);
      }
    };
    const openEv = () => setOpen(true);
    window.addEventListener("keydown", on, true);
    window.addEventListener("npd-open-palette", openEv);
    return () => {
      window.removeEventListener("keydown", on, true);
      window.removeEventListener("npd-open-palette", openEv);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setI(0);
    load();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo(() => {
    const k = q.trim().toLowerCase();
    const pageItems: Item[] = pages.map((p) => ({ key: `g:${p.href}`, group: "화면", icon: "↗", label: p.label, href: p.href }));
    const all = [...pageItems, ...(data ?? [])];
    if (!k) return [...pageItems, ...(data ?? []).filter((x) => x.group === "메모").slice(0, 8)];
    const cho = isChoOnly(k);
    const hit = (x: Item) => {
      const text = `${x.label} ${x.hint ?? ""}`.toLowerCase();
      return cho ? chosung(text).replace(/\s/g, "").includes(k.replace(/\s/g, "")) : text.includes(k);
    };
    const res = all.filter(hit);
    // 제목이 검색어로 시작하면 위로
    res.sort((a, b) => Number(b.label.toLowerCase().startsWith(k)) - Number(a.label.toLowerCase().startsWith(k)));
    const byGroup: Record<string, Item[]> = {};
    res.forEach((x) => (byGroup[x.group] ??= []).push(x));
    return ["화면", "메모", "프로젝트", "단계"].flatMap((g) => (byGroup[g] ?? []).slice(0, g === "단계" ? 12 : 8));
  }, [q, data, pages]);

  useEffect(() => setI(0), [q]);
  useEffect(() => {
    box.current?.querySelector<HTMLElement>(`[data-i="${i}"]`)?.scrollIntoView({ block: "nearest" });
  }, [i]);

  if (!open) return null;
  const go = (it: Item | undefined) => {
    if (!it) return;
    setOpen(false);
    router.push(it.href);
  };
  let last = "";
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-slate-900/30 px-4 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl" role="dialog" aria-label="빠른 이동">
        <div className="flex items-center gap-2 border-b border-black/[0.06] px-4">
          <span className="text-slate-400">🔍</span>
          <input
            autoFocus
            className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-slate-400"
            placeholder="메모·프로젝트·단계 찾기 (초성도 돼요: ㅂㄹㄷ)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "ArrowDown") (e.preventDefault(), setI((v) => Math.min(v + 1, items.length - 1)));
              else if (e.key === "ArrowUp") (e.preventDefault(), setI((v) => Math.max(v - 1, 0)));
              else if (e.key === "Enter") (e.preventDefault(), go(items[i]));
              else if (e.key === "Escape") setOpen(false);
            }}
          />
          <kbd className="rounded border border-black/10 px-1.5 text-[10px] text-slate-400">Esc</kbd>
        </div>
        <div ref={box} className="scroll-thin max-h-[55vh] overflow-y-auto p-1.5">
          {data === null && q && <p className="px-3 py-4 text-sm text-slate-400">불러오는 중…</p>}
          {data !== null && items.length === 0 && <p className="px-3 py-4 text-sm text-slate-400">찾는 항목이 없습니다.</p>}
          {items.map((it, idx) => {
            const head = it.group !== last ? it.group : null;
            last = it.group;
            return (
              <div key={it.key}>
                {head && <div className="px-2.5 pb-1 pt-2 text-[11px] text-slate-400">{head === "메모" && !q ? "최근 메모" : head}</div>}
                <button data-i={idx} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm ${idx === i ? "bg-slate-100" : ""}`} onMouseEnter={() => setI(idx)} onClick={() => go(it)}>
                  <span className="w-5 text-center text-xs">{it.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.hint && <span className="max-w-[45%] truncate text-[11px] text-slate-400">{it.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex gap-3 border-t border-black/[0.06] px-4 py-1.5 text-[11px] text-slate-400">
          <span>↑↓ 고르기</span>
          <span>Enter 이동</span>
          <span className="ml-auto">Ctrl+K 로 언제든 열기</span>
        </div>
      </div>
    </div>
  );
}
