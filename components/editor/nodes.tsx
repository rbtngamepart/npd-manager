"use client";

// 편집기 블록: 콜아웃 · 이미지 · 파일 · 임베드 · @사람 · [[메모·단계 링크]]
import { useEffect, useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import Image from "@tiptap/extension-image";
import Mention from "@tiptap/extension-mention";
import { embedFor, fmtSize, openFile, signedUrl } from "./files";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (attrs?: { emoji?: string; color?: string }) => ReturnType;
      toggleCallout: () => ReturnType;
    };
    embed: {
      setEmbed: (src: string) => ReturnType;
    };
    fileBlock: {
      setFileBlock: (attrs: { path: string; name: string; size?: number; mime?: string }) => ReturnType;
    };
  }
}

// ---- 콜아웃 -----------------------------------------------------------------
export const CALLOUT_EMOJIS = ["💡", "📌", "⚠️", "✅", "❗", "📣", "🔥", "❓", "🎯", "📝"];
export const CALLOUT_COLORS = ["gray", "blue", "yellow", "red", "green", "purple"] as const;

function CalloutView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const emoji = (node.attrs.emoji as string) || "💡";
  const color = (node.attrs.color as string) || "gray";
  const next = <T,>(list: readonly T[], cur: T) => list[(list.indexOf(cur) + 1) % list.length];
  return (
    <NodeViewWrapper data-type="callout" data-color={color} data-emoji={emoji} className="npd-callout">
      <span contentEditable={false} className="npd-callout-side">
        <button
          type="button"
          className="npd-callout-emoji"
          title="눌러서 아이콘 바꾸기"
          disabled={!editor.isEditable}
          onClick={() => updateAttributes({ emoji: next(CALLOUT_EMOJIS, emoji) })}
        >
          {emoji}
        </button>
        {editor.isEditable && (
          <button type="button" className="npd-callout-color" title="눌러서 색 바꾸기" onClick={() => updateAttributes({ color: next(CALLOUT_COLORS, color as (typeof CALLOUT_COLORS)[number]) })} />
        )}
      </span>
      <NodeViewContent className="npd-callout-body" />
    </NodeViewWrapper>
  );
}

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      emoji: { default: "💡", parseHTML: (el) => el.getAttribute("data-emoji") || "💡", renderHTML: (a) => ({ "data-emoji": a.emoji }) },
      color: { default: "gray", parseHTML: (el) => el.getAttribute("data-color") || "gray", renderHTML: (a) => ({ "data-color": a.color }) },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "callout" }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },
  addCommands() {
    return {
      setCallout:
        (attrs) =>
        ({ commands }) =>
          commands.wrapIn(this.name, attrs),
      toggleCallout:
        () =>
        ({ commands }) =>
          commands.toggleWrap(this.name),
    };
  },
});

// ---- 이미지 (저장소 경로 또는 외부 https 주소) ---------------------------------
function ImageView({ node, selected }: ReactNodeViewProps) {
  const path = node.attrs.path as string | null;
  const [src, setSrc] = useState<string | null>(path ? null : (node.attrs.src as string | null));
  useEffect(() => {
    let dead = false;
    if (path) signedUrl(path).then((u) => !dead && setSrc(u));
    else setSrc(node.attrs.src as string | null);
    return () => {
      dead = true;
    };
  }, [path, node.attrs.src]);
  return (
    <NodeViewWrapper className={`npd-img ${selected ? "is-selected" : ""}`} data-drag-handle>
      {src ? <img src={src} alt={(node.attrs.alt as string) || ""} draggable={false} /> : <span className="npd-img-loading">이미지 불러오는 중…</span>}
    </NodeViewWrapper>
  );
}

export const FileImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      path: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-path"),
        renderHTML: (a) => (a.path ? { "data-path": a.path } : {}),
      },
      src: {
        default: null,
        // 저장소 이미지는 주소를 저장하지 않음 (보일 때마다 새로 발급)
        parseHTML: (el) => (el.getAttribute("data-path") ? null : el.getAttribute("src")),
        renderHTML: (a) => (a.src && /^https:\/\//.test(a.src) ? { src: a.src } : {}),
      },
    };
  },
  // 저장소 이미지는 src 없이 data-path 만 저장하므로, 그것도 이미지로 읽어야 함
  //   (기본 규칙은 img[src] 만 읽어서, 다시 열면 사진이 사라지고 그대로 저장되면 지워지던 문제)
  parseHTML() {
    return [{ tag: "img[data-path]" }, { tag: 'img[src]:not([src^="data:"]):not([src^="blob:"]):not([src^="file:"])' }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
}).configure({ inline: false, allowBase64: false });

// ---- 파일 ------------------------------------------------------------------
function FileView({ node, selected }: ReactNodeViewProps) {
  const a = node.attrs as { path: string; name: string; size: number };
  return (
    <NodeViewWrapper className={`npd-file ${selected ? "is-selected" : ""}`} data-drag-handle>
      <button type="button" contentEditable={false} onClick={() => openFile(a.path)} title="눌러서 열기">
        <span>📎</span>
        <b>{a.name}</b>
        {a.size ? <i>{fmtSize(a.size)}</i> : null}
      </button>
    </NodeViewWrapper>
  );
}

export const FileBlock = Node.create({
  name: "fileBlock",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      path: { default: "", parseHTML: (el) => el.getAttribute("data-path"), renderHTML: (a) => ({ "data-path": a.path }) },
      name: { default: "파일", parseHTML: (el) => el.getAttribute("data-name") || "파일", renderHTML: (a) => ({ "data-name": a.name }) },
      size: { default: 0, parseHTML: (el) => Number(el.getAttribute("data-size")) || 0, renderHTML: (a) => ({ "data-size": a.size }) },
      mime: { default: "", parseHTML: (el) => el.getAttribute("data-mime") || "", renderHTML: (a) => ({ "data-mime": a.mime }) },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="file"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "file" }), `📎 ${node.attrs.name}`];
  },
  renderText({ node }) {
    return `📎 ${node.attrs.name}`;
  },
  addNodeView() {
    return ReactNodeViewRenderer(FileView);
  },
  addCommands() {
    return {
      setFileBlock:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

// ---- 임베드 (유튜브·구글 드라이브는 화면, 나머지는 북마크 카드) -----------------
function EmbedView({ node, selected }: ReactNodeViewProps) {
  const info = embedFor(node.attrs.src as string);
  return (
    <NodeViewWrapper className={`npd-embed-wrap ${selected ? "is-selected" : ""}`} data-drag-handle>
      <div data-type="embed" contentEditable={false}>
        {info?.iframe ? (
          <iframe src={info.iframe} allowFullScreen loading="lazy" referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-popups allow-presentation" />
        ) : info ? (
          <a className="npd-bookmark" href={info.src} target="_blank" rel="noopener noreferrer">
            <span className="npd-bookmark-ico">🔗</span>
            <span className="npd-bookmark-text">
              <b>{safeHost(info.src)}</b>
              <span>{info.src}</span>
            </span>
          </a>
        ) : (
          <span className="text-xs text-slate-400">주소를 읽을 수 없습니다</span>
        )}
      </div>
    </NodeViewWrapper>
  );
}
function safeHost(s: string) {
  try {
    return new URL(s).hostname.replace(/^www\./, "");
  } catch {
    return s;
  }
}

export const Embed = Node.create({
  name: "embed",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: "", parseHTML: (el) => el.getAttribute("data-src") || "", renderHTML: (a) => ({ "data-src": a.src }) },
      provider: { default: "bookmark", parseHTML: (el) => el.getAttribute("data-provider") || "bookmark", renderHTML: (a) => ({ "data-provider": a.provider }) },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="embed"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "embed" }), node.attrs.src];
  },
  renderText({ node }) {
    return node.attrs.src as string;
  },
  addNodeView() {
    return ReactNodeViewRenderer(EmbedView);
  },
  addCommands() {
    return {
      setEmbed:
        (src) =>
        ({ commands }) => {
          const info = embedFor(src);
          if (!info) return false;
          return commands.insertContent([{ type: this.name, attrs: { src: info.src, provider: info.provider } }, { type: "paragraph" }]);
        },
    };
  },
});

// ---- @사람 · [[메모·단계]] -------------------------------------------------
export const PersonMention = Mention.extend({
  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes({ "data-type": "mention", class: "mention" }, HTMLAttributes), `@${node.attrs.label ?? ""}`];
  },
  renderText({ node }) {
    return `@${node.attrs.label ?? ""}`;
  },
});

export const RefLink = Mention.extend({
  name: "ref",
  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.getAttribute("data-id"), renderHTML: (a) => ({ "data-id": a.id }) },
      label: { default: "", parseHTML: (el) => el.getAttribute("data-label") || el.textContent?.replace(/^[📄◆]\s*/u, "") || "", renderHTML: (a) => ({ "data-label": a.label }) },
      kind: { default: "note", parseHTML: (el) => el.getAttribute("data-kind") || "note", renderHTML: (a) => ({ "data-kind": a.kind }) },
      href: { default: "", parseHTML: (el) => el.getAttribute("href") || "", renderHTML: (a) => (a.href && /^\/[\w/?=&%.-]*$/.test(a.href) ? { href: a.href } : {}) },
    };
  },
  parseHTML() {
    return [{ tag: 'a[data-type="ref"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["a", mergeAttributes({ "data-type": "ref", class: "npd-ref" }, HTMLAttributes), `${node.attrs.kind === "stage" ? "◆" : "📄"} ${node.attrs.label}`];
  },
  renderText({ node }) {
    return `[[${node.attrs.label}]]`;
  },
});
