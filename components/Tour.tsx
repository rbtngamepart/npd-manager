"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { CHAPTERS, type Chapter, type Role, type TourEvent, type TourStep } from "@/lib/tutorial";
import { useApp } from "./AppProvider";
import { Modal } from "./ui";

const DONE_KEY = "npd-tour-done";
const SEEN_KEY = "npd-tour-seen";

function readDone(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DONE_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function writeDone(ids: string[]) {
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify(ids));
  } catch {
    /* 저장 불가 환경 무시 */
  }
}
export function tourSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
}
export function markTourSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* 무시 */
  }
}

/** 화면(페이지)에 튜토리얼 동작을 보냄 */
export function sendTourEvent(e: TourEvent) {
  window.dispatchEvent(new CustomEvent<TourEvent>("npd-tour", { detail: e }));
}

/** 페이지에서 튜토리얼 동작 받기 */
export function useTourEvents(handler: (e: TourEvent) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const fn = (ev: Event) => ref.current((ev as CustomEvent<TourEvent>).detail);
    window.addEventListener("npd-tour", fn);
    return () => window.removeEventListener("npd-tour", fn);
  }, []);
}

const sel = (name: string) => `[data-tour="${name}"]`;

function waitFor(name: string, ms: number, alive: () => boolean): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      if (!alive()) return resolve(null);
      const el = document.querySelector<HTMLElement>(sel(name));
      if (el && el.getClientRects().length) return resolve(el);
      if (Date.now() - t0 > ms) return resolve(null);
      setTimeout(tick, 80);
    };
    tick();
  });
}

interface Running {
  chapter: Chapter;
  steps: TourStep[];
  idx: number;
  projectId: string | null;
}

const TourCtx = createContext<{ openMenu: () => void; start: (id: string) => void }>({
  openMenu: () => {},
  start: () => {},
});
export const useTour = () => useContext(TourCtx);

export function TourProvider({ children }: { children: React.ReactNode }) {
  const { me } = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const [menu, setMenu] = useState(false);
  const [run, setRun] = useState<Running | null>(null);
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [searching, setSearching] = useState(false);
  const [done, setDone] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const token = useRef(0);
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => setDone(readDone()), []);

  const openMenu = useCallback(() => {
    setNotice(null);
    setMenu(true);
    markTourSeen();
  }, []);

  const start = useCallback(
    async (id: string) => {
      const chapter = CHAPTERS.find((c) => c.id === id);
      if (!chapter || !me) return;
      markTourSeen();
      let projectId: string | null = null;
      let isMember = false;
      if (chapter.needsProject) {
        const m = pathRef.current.match(/^\/projects\/([0-9a-f-]{36})/);
        projectId = m?.[1] ?? null;
        if (!projectId) {
          const { data } = await supabase()
            .from("projects")
            .select("id")
            .eq("archived", false)
            .order("updated_at", { ascending: false })
            .limit(1);
          projectId = data?.[0]?.id ?? null;
        }
        if (!projectId) {
          setNotice(
            me.is_game_part
              ? "이 단원은 프로젝트 화면에서 진행됩니다. 먼저 '새 프로젝트 만들기' 단원을 보고 프로젝트를 하나 만들어 주세요."
              : "이 단원은 프로젝트 화면에서 진행됩니다. 아직 프로젝트가 없어요."
          );
          return;
        }
        const { data: mem } = await supabase()
          .from("project_members")
          .select("user_id")
          .eq("project_id", projectId)
          .eq("user_id", me.id);
        isMember = !!mem?.length;
      }
      const has = (r?: Role) =>
        !r ||
        (r === "admin" && me.is_admin) ||
        (r === "gamepart" && me.is_game_part) ||
        (r === "editor" && (me.is_game_part || isMember));
      if (!has(chapter.role)) {
        setNotice("이 단원은 편집 권한이 있는 사용자용입니다.");
        return;
      }
      const steps = chapter.steps.filter((s) => has(s.role));
      setMenu(false);
      setRun({ chapter, steps, idx: 0, projectId });
    },
    [me]
  );

  const finish = useCallback(
    (completed: boolean) => {
      token.current++;
      if (run) {
        run.chapter.cleanup?.forEach(sendTourEvent);
        if (completed) {
          const next = Array.from(new Set([...readDone(), run.chapter.id]));
          writeDone(next);
          setDone(next);
        }
      }
      setRun(null);
      setEl(null);
      setRect(null);
      if (completed) setMenu(true);
    },
    [run]
  );

  // 단계가 바뀔 때: 화면 이동 → 준비 대기 → 동작 보내기 → 강조할 요소 찾기
  useEffect(() => {
    if (!run) return;
    const my = ++token.current;
    const alive = () => token.current === my;
    const step = run.steps[run.idx];
    (async () => {
      setEl(null);
      setRect(null);
      setSearching(true);
      const path = step.route === "project" ? `/projects/${run.projectId}` : step.route;
      if (path && pathRef.current !== path) router.push(path);
      if (step.ready) await waitFor(step.ready, 6000, alive);
      if (!alive()) return;
      if (step.event) {
        sendTourEvent(step.event);
        await new Promise((r) => setTimeout(r, 120));
      }
      let found: HTMLElement | null = null;
      if (step.target) found = await waitFor(step.target, path ? 6000 : 2500, alive);
      if (!alive()) return;
      if (found) {
        found.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
        setEl(found);
      }
      setSearching(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.chapter.id, run?.idx]);

  // 강조 위치를 계속 따라감 (스크롤·크기 변경 대응)
  useEffect(() => {
    if (!el) return;
    let raf = 0;
    let last = "";
    const loop = () => {
      const r = el.getBoundingClientRect();
      const key = `${r.x}|${r.y}|${r.width}|${r.height}`;
      if (key !== last) {
        last = key;
        setRect(r);
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [el]);

  // 키보드
  useEffect(() => {
    if (!run) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish(false);
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function go(d: 1 | -1) {
    if (!run) return;
    const n = run.idx + d;
    if (n < 0) return;
    if (n >= run.steps.length) return finish(true);
    setRun({ ...run, idx: n });
  }

  const step = run?.steps[run.idx];
  const total = run?.steps.length ?? 0;
  const nextChapter = CHAPTERS.find((c) => !done.includes(c.id));

  return (
    <TourCtx.Provider value={{ openMenu, start }}>
      {children}

      <Modal open={menu} onClose={() => setMenu(false)} title="튜토리얼" width="max-w-xl">
        <p className="mb-4 text-sm text-slate-600">
          단원을 고르면 실제 화면의 해당 부분을 하나씩 짚으며 설명합니다. 데이터는 바뀌지 않아요. <span className="text-slate-400">(← → 키로 넘기기, Esc로 종료)</span>
        </p>
        {notice && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{notice}</p>}
        <ol className="space-y-1.5">
          {CHAPTERS.map((c, i) => {
            const isDone = done.includes(c.id);
            const isNext = nextChapter?.id === c.id;
            return (
              <li key={c.id}>
                <button
                  onClick={() => start(c.id)}
                  className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition hover:border-brand-500 hover:bg-brand-50/40 ${
                    isNext ? "border-brand-500/60 bg-brand-50/30" : "border-black/[0.07]"
                  }`}
                >
                  <span
                    className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                      isDone ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {isDone ? "✓" : i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {c.title}
                      {c.role === "gamepart" && <span className="ml-1.5 text-[11px] font-normal text-slate-400">게임파트</span>}
                      {c.role === "editor" && <span className="ml-1.5 text-[11px] font-normal text-slate-400">편집자</span>}
                    </span>
                    <span className="block text-xs text-slate-500">{c.desc}</span>
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">{isNext ? "다음 추천 ›" : `약 ${c.minutes}분`}</span>
                </button>
              </li>
            );
          })}
        </ol>
        {done.length > 0 && (
          <button
            className="btn-ghost mt-3 -ml-3 text-xs text-slate-400"
            onClick={() => {
              writeDone([]);
              setDone([]);
            }}
          >
            완료 표시 초기화
          </button>
        )}
      </Modal>

      {run && step && (
        <>
          {/* 클릭 막는 층 */}
          <div className="fixed inset-0 z-[70]" onClick={(e) => e.stopPropagation()} />
          {/* 어둡게 + 강조 구멍 */}
          {rect ? (
            <div
              className="pointer-events-none fixed z-[71] rounded-lg ring-2 ring-brand-500 transition-all duration-200"
              style={{
                left: rect.left - 6,
                top: rect.top - 6,
                width: rect.width + 12,
                height: rect.height + 12,
                boxShadow: "0 0 0 9999px rgba(15,16,20,0.55)",
              }}
            />
          ) : (
            <div className="pointer-events-none fixed inset-0 z-[71] bg-[rgba(15,16,20,0.55)]" />
          )}
          <Popover
            rect={rect}
            title={step.title}
            body={step.body}
            chapter={run.chapter.title}
            idx={run.idx}
            total={total}
            loading={searching && !rect}
            onPrev={() => go(-1)}
            onNext={() => go(1)}
            onClose={() => finish(false)}
          />
        </>
      )}
    </TourCtx.Provider>
  );
}

function Popover({
  rect,
  title,
  body,
  chapter,
  idx,
  total,
  loading,
  onPrev,
  onNext,
  onClose,
}: {
  rect: DOMRect | null;
  title: string;
  body: string;
  chapter: string;
  idx: number;
  total: number;
  loading: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(220);
  useEffect(() => {
    if (box.current) setH(box.current.offsetHeight);
  });

  const W = Math.min(360, (typeof window !== "undefined" ? window.innerWidth : 400) - 24);
  let style: React.CSSProperties;
  if (!rect) {
    style = { left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: Math.min(420, W + 60) };
  } else {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 16;
    const left = Math.max(12, Math.min(vw - W - 12, rect.left));
    if (rect.bottom + gap + h < vh) style = { left, top: rect.bottom + gap, width: W };
    else if (rect.top - gap - h > 0) style = { left, top: rect.top - gap - h, width: W };
    else if (rect.left - gap - W > 0) style = { left: rect.left - gap - W, top: Math.max(12, Math.min(vh - h - 12, rect.top)), width: W };
    else style = { right: 16, bottom: 16, width: W };
  }

  return (
    <div ref={box} className="fixed z-[72] rounded-xl bg-white p-4 shadow-2xl ring-1 ring-black/5" style={style}>
      <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-400">
        <span className="font-medium text-brand-600">{chapter}</span>
        <span>
          {idx + 1} / {total}
        </span>
        <button className="ml-auto rounded px-1 hover:bg-black/5" onClick={onClose} aria-label="튜토리얼 닫기">
          ✕
        </button>
      </div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-slate-600">{loading ? "화면을 여는 중…" : body}</p>
      <div className="mt-3 flex items-center gap-1">
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className={`h-1 flex-1 rounded-full ${i <= idx ? "bg-brand-500" : "bg-slate-200"}`} />
        ))}
      </div>
      <div className="mt-3 flex justify-between">
        <button className="btn-ghost -ml-2 text-xs" disabled={idx === 0} onClick={onPrev}>
          ← 이전
        </button>
        <button className="btn-primary text-xs" onClick={onNext}>
          {idx === total - 1 ? "완료 ✓" : "다음 →"}
        </button>
      </div>
    </div>
  );
}
