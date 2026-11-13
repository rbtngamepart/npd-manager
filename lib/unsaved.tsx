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

type Ask = (what: string, canSave: boolean) => Promise<"save" | "discard" | "cancel">;
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
    ? await ask(what, canSave)
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
  const [dlg, setDlg] = useState<{ what: string; canSave: boolean; resolve: (c: "save" | "discard" | "cancel") => void } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    ask = (what, canSave) => new Promise((resolve) => setDlg({ what, canSave, resolve }));
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
        dlg.resolve("cancel");
        setDlg(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dlg, saving]);

  if (!dlg) return null;
  const pick = async (c: "save" | "discard" | "cancel") => {
    if (c === "save") setSaving(true);
    dlg.resolve(c);
    setDlg(null);
    setSaving(false);
  };
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/30 p-4" onMouseDown={() => pick("cancel")}>
      <div className="card w-full max-w-sm p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true">
        <h2 className="text-base font-semibold">저장하고 나가시겠습니까?</h2>
        <p className="mt-1.5 text-sm text-slate-600">저장하지 않은 내용이 있습니다.</p>
        <p className="mt-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{dlg.what}</p>
        <div className="mt-4 flex flex-col gap-2">
          {dlg.canSave && (
            <button autoFocus className="btn-primary w-full justify-center" disabled={saving} onClick={() => pick("save")}>
              저장하고 나가기
            </button>
          )}
          <button className="btn-outline w-full justify-center text-rose-600" onClick={() => pick("discard")}>
            저장하지 않고 나가기
          </button>
          <button className="btn-ghost w-full justify-center" onClick={() => pick("cancel")}>
            취소 (계속 작성)
          </button>
        </div>
      </div>
    </div>
  );
}
