"use client";

// 마인드맵 편집기 (mind-elixir)
//   Tab 하위 · Enter 같은 단계 · F2/두 번 눌러 고치기 · Delete 지우기 · Ctrl+Z 되돌리기
import "mind-elixir/style.css";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { MindElixirData, MindElixirInstance } from "mind-elixir";

export interface MindMapHandle {
  exportPng: () => Promise<Blob | null>;
  center: () => void;
  /** 개요(글머리 목록 HTML) — 문서로 옮길 때 */
  outlineHtml: () => string;
}

function isData(v: unknown): v is MindElixirData {
  return !!v && typeof v === "object" && "nodeData" in (v as object) && !!(v as MindElixirData).nodeData?.id;
}

interface Node {
  topic: string;
  children?: Node[];
}

/** 마인드맵 → 검색용 글자 (한 줄에 하나, 들여쓰기) */
export const DEFAULT_ROOT = "중심 주제";

/** 가운데 주제가 아직 기본값이면 제목으로 바꾼 데이터 (아니면 null) */
export function withRootTitle(v: unknown, title: string): MindElixirData | null {
  const t = title.trim();
  if (!t || !isData(v) || v.nodeData.topic !== DEFAULT_ROOT) return null;
  return { ...v, nodeData: { ...v.nodeData, topic: t } };
}

export function mindmapText(v: unknown): string {
  if (!isData(v)) return "";
  const out: string[] = [];
  const walk = (n: Node, d: number) => {
    out.push("  ".repeat(d) + (n.topic ?? ""));
    (n.children ?? []).forEach((c) => walk(c, d + 1));
  };
  walk(v.nodeData as unknown as Node, 0);
  return out.join("\n");
}

function outline(v: unknown): string {
  if (!isData(v)) return "";
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const list = (ns: Node[] | undefined): string => (ns?.length ? `<ul>${ns.map((n) => `<li><p>${esc(n.topic ?? "")}</p>${list(n.children)}</li>`).join("")}</ul>` : "");
  const root = v.nodeData as unknown as Node;
  return `<p><strong>${esc(root.topic ?? "")}</strong></p>${list(root.children)}`;
}

export const MindMap = forwardRef<
  MindMapHandle,
  {
    value: unknown;
    /** 바뀌면 value로 다시 그림 (다른 메모를 열 때 등) */
    resetKey: string;
    onChange: (data: MindElixirData) => void;
    readOnly?: boolean;
    rootTitle?: string;
  }
>(function MindMap({ value, resetKey, onChange, readOnly, rootTitle }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const inst = useRef<MindElixirInstance | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;

  useImperativeHandle(ref, () => ({
    exportPng: async () => (inst.current ? inst.current.exportPng() : null),
    center: () => inst.current?.toCenter(),
    outlineHtml: () => outline(inst.current?.getData() ?? valueRef.current),
  }));

  useEffect(() => {
    let dead = false;
    let me: MindElixirInstance | null = null;
    let ro: ResizeObserver | null = null;
    (async () => {
      const [{ default: MindElixir }, { ko }] = await Promise.all([import("mind-elixir"), import("mind-elixir/i18n")]);
      if (dead || !box.current) return;
      box.current.innerHTML = "";
      const host = document.createElement("div");
      host.style.width = "100%";
      host.style.height = "100%";
      box.current.appendChild(host);
      me = new MindElixir({
        el: host,
        direction: MindElixir.SIDE,
        editable: !readOnly,
        contextMenu: readOnly ? false : { locale: ko, focus: true, link: true },
        toolBar: true,
        keypress: !readOnly,
        allowUndo: true,
        newTopicName: "새 생각",
        alignment: "nodes",
      });
      const v = valueRef.current;
      me.init(isData(v) ? v : MindElixir.new(rootTitle?.trim() || DEFAULT_ROOT));
      // 새 마인드맵을 제목으로 시작했으면 바로 저장되게
      if (!isData(v) && rootTitle?.trim() && !readOnly) changeRef.current(me.getData());
      me.bus.addListener("operation", (op: { name: string }) => {
        if (op.name === "beginEdit") return;
        changeRef.current(me!.getData());
      });
      inst.current = me;
      // 상자 크기가 정해진 뒤 가운데로 (처음 그릴 때 한쪽으로 쏠리지 않게)
      requestAnimationFrame(() => !dead && me?.toCenter());
      let lastW = host.clientWidth;
      ro = new ResizeObserver(() => {
        if (dead || Math.abs(host.clientWidth - lastW) < 40) return;
        lastW = host.clientWidth;
        me?.toCenter();
      });
      ro.observe(host);
      // 처음 보는 사람도 바로 쓸 수 있게 가운데 주제 선택
      if (!readOnly) {
        const root = host.querySelector<HTMLElement>("me-root me-tpc, me-tpc");
        if (root) me.selectNode(root as never);
      }
    })();
    return () => {
      dead = true;
      ro?.disconnect();
      try {
        me?.destroy();
      } catch {
        /* 무시 */
      }
      inst.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, readOnly]);

  return <div ref={box} className="npd-mindmap h-full w-full" />;
});
