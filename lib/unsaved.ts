"use client";
// 저장하지 않은 입력이 있을 때 나가기 전에 물어보기
import { useEffect } from "react";

const dirty = new Map<string, string>(); // key → 무엇을 고치는 중인지

export function markDirty(key: string, label: string | null) {
  if (label) dirty.set(key, label);
  else dirty.delete(key);
}

export function hasUnsaved(): boolean {
  return dirty.size > 0;
}

/** 저장 안 한 내용이 있으면 확인창. 나가도 되면 true */
export function confirmLeave(only?: string[]): boolean {
  const keys = Array.from(dirty.keys()).filter((k) => !only || only.includes(k));
  if (!keys.length) return true;
  const what = Array.from(new Set(keys.map((k) => dirty.get(k)))).join(", ");
  const ok = window.confirm(`저장하지 않은 내용이 있습니다.\n(${what})\n\n저장하지 않고 나가시겠습니까?`);
  if (ok) keys.forEach((k) => dirty.delete(k));
  return ok;
}

/** 컴포넌트에서: 고치는 중이면 등록, 화면에서 사라지면 해제 */
export function useUnsaved(key: string, label: string, isDirty: boolean) {
  useEffect(() => {
    markDirty(key, isDirty ? label : null);
  }, [key, label, isDirty]);
  useEffect(() => () => markDirty(key, null), [key]);
}

/** 앱 전체에 한 번: 새로고침·창 닫기, 사이트 안 링크 이동을 막고 물어봄 */
export function UnsavedGuard() {
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
      if (!confirmLeave()) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, []);
  return null;
}
