"use client";
// 저장하지 않은 입력이 있을 때 나가기 전에 물어보기
//   [저장하고 나가기] [저장하지 않고 나가기] [취소]
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Entry {
  label: string;
  /** 저장 함수. 성공하면 true */
  save?: () => Promise<boolean>;
}

const dirty = new Map<string, Entry>();

export function markDirty(key: string, entry: Entry | null) {
  if (entry) dirty.set(key, entry);
  else dirty.delete(key);
}

export function hasUnsaved(): boolean {
  return dirty.size > 0;
}

/**
 * 지금 고치고 있는 것을 모두 저장 (Ctrl+S)
 *   "none": 저장할 게 없음 · "ok": 저장함 · "fail": 실패(또는 저장 기능 없는 입력만 있음)
 */
export async function saveAllDirty(): Promise<"none" | "ok" | "fail"> {
  const entries = Array.from(dirty.values());
  if (!entries.length) return "none";
  let ok = true;
  for (const e of entries) {
    if (!e.save) {
      ok = false;
      continue;
    }
    try {
      if (!(await e.save())) ok = false;
    } catch {
      ok = false;
    }
  }
  return ok ? "ok" : "fail";
}

export interface AskText {
  title: string;
  save: string;
  discard: string;
}
const LEAVE: AskText = { title: "저장하고 나가시겠습니까?", save: "저장하고 나가기", discard: "저장하지 않고 나가기" };

type Ask = (what: string, canSave: boolean, text: AskText) => Promise<"save" | "discard" | "cancel">;
let ask: Ask | null = null;

/**
 * 저장 안 한 내용이 있으면 확인창. 나가도 되면 true
 * only: 이 key들만 확인 (예: 설정 탭만)
 */
export async function confirmLeave(only?: string[]): Promise<boolean> {
  const keys = Array.from(dirty.keys()).filter((k) => !only || only.includes(k));
  if (!keys.length) return true;
  const entries = keys.map((k) => dirty.get(k)!);
  const what = Array.from(new Set(entries.map((e) => e.label))).join(", ");
  const canSave = entries.every((e) => !!e.save);
  const choice = ask
    ? await ask(what, canSave, LEAVE)
    : window.confirm(`저장하지 않은 내용이 있습니다.\n(${what})\n\n저장하지 않고 나가시겠습니까?`)
      ? "discard"
      : "cancel";
  if (choice === "cancel") return false;
  if (choice === "save") {
    for (const e of entries) {
      const ok = await e.save!();
      if (!ok) return false; // 저장 실패하면 머무름
    }
  }
  keys.forEach((k) => dirty.delete(k));
  return true;
}

/**
 * 같은 모양의 확인창을 직접 띄움 (예: 큰 창에서 고치던 기록을 닫을 때)
 *   [저장하고 닫기] [저장하지 않고 닫기] [취소]
 */
export async function askSave(what: string, text: AskText = { title: "저장하고 닫으시겠습니까?", save: "저장하고 닫기", discard: "저장하지 않고 닫기" }) {
  if (ask) return ask(what, true, text);
  return window.confirm(`${text.title}\n(${what})`) ? "save" : "discard";
}

/** 컴포넌트에서: 고치는 중이면 등록, 화면에서 사라지면 해제 */
export function useUnsaved(key: string, label: string, isDirty: boolean, save?: () => Promise<boolean>) {
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    markDirty(key, isDirty ? { label, save: saveRef.current ? () => saveRef.current!() : undefined } : null);
  }, [key, label, isDirty]);
  useEffect(() => () => markDirty(key, null), [key]);
}

/** 앱 전체에 한 번: 확인창 + 새로고침·창 닫기, 사이트 안 링크 이동 */
export function UnsavedGuard() {
  const router = useRouter();
  const [dlg, setDlg] = useState<{ what: string; canSave: boolean; text: AskText; resolve: (c: "save" | "discard" | "cancel") => void } | null>(null);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctrlS = useRef(false);
  const dlgOpen = useRef(false);
  dlgOpen.current = !!dlg;

  // Ctrl+S (맥은 ⌘S): 고치던 내용 모두 저장. 브라우저의 '페이지 저장' 창은 막음
  useEffect(() => {
    const show = (m: string) => {
      setFlash(m);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), 1800);
    };
    const onKey = async (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.code !== "KeyS") return;
      e.preventDefault();
      if (dlgOpen.current || ctrlS.current) return;
      ctrlS.current = true;
      show("저장 중…");
      const r = await saveAllDirty();
      ctrlS.current = false;
      show(r === "none" ? "바뀐 내용이 없어요 (이미 저장됨)" : r === "ok" ? "✓ 저장했습니다" : "저장하지 못한 내용이 있어요");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    ask = (what, canSave, text) => new Promise((resolve) => setDlg({ what, canSave, text, resolve }));
    return () => {
      ask = null;
    };
  }, []);

  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty.size) return;
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (!dirty.size || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      let url: URL;
      try {
        url = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname + url.search === window.location.pathname + window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      confirmLeave().then((ok) => ok && router.push(url.pathname + url.search + url.hash));
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [router]);

  useEffect(() => {
    if (!dlg) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) {
        e.stopPropagation();
        dlg.resolve("cancel");
        setDlg(null);
      }
    };
    // 다른 창(큰 창 등)의 Esc보다 먼저 받음
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dlg, saving]);

  const flashEl = flash && (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[95] -translate-x-1/2 rounded-full bg-slate-900/90 px-4 py-1.5 text-xs text-white shadow-lg" role="status">
      {flash}
    </div>
  );
  if (!dlg) return flashEl || null;
  const pick = async (c: "save" | "discard" | "cancel") => {
    if (c === "save") setSaving(true);
    dlg.resolve(c);
    setDlg(null);
    setSaving(false);
  };
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/30 p-4" onMouseDown={() => pick("cancel")}>
      <div className="card w-full max-w-sm p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true">
        <h2 className="text-base font-semibold">{dlg.text.title}</h2>
        <p className="mt-1.5 text-sm text-slate-600">저장하지 않은 내용이 있습니다.</p>
        <p className="mt-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{dlg.what}</p>
        <div className="mt-4 flex flex-col gap-2">
          {dlg.canSave && (
            <button autoFocus className="btn-primary w-full justify-center" disabled={saving} onClick={() => pick("save")}>
              {dlg.text.save}
            </button>
          )}
          <button className="btn-outline w-full justify-center text-rose-600" onClick={() => pick("discard")}>
            {dlg.text.discard}
          </button>
          <button className="btn-ghost w-full justify-center" onClick={() => pick("cancel")}>
            취소 (계속 작성)
          </button>
        </div>
      </div>
    </div>
  );
}
