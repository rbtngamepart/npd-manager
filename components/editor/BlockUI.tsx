"use client";

// 노션식 편집 도구: 왼쪽 손잡이(⋮⋮ 끌어 옮기기·메뉴, + 블록 추가) · 글자를 고르면 뜨는 서식 툴바
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import DragHandle from "@tiptap/extension-drag-handle-react";
import { NodeSelection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";

export const TEXT_COLORS = [
  { v: "", label: "기본" },
  { v: "#e11d48", label: "빨강" },
  { v: "#d97706", label: "주황" },
  { v: "#059669", label: "초록" },
  { v: "#2563eb", label: "파랑" },
  { v: "#7c3aed", label: "보라" },
  { v: "#64748b", label: "회색" },
];
export const HIGHLIGHTS = [
  { v: "", label: "없음" },
  { v: "#fef08a", label: "노랑" },
  { v: "#fecaca", label: "빨강" },
  { v: "#bbf7d0", label: "초록" },
  { v: "#bfdbfe", label: "파랑" },
  { v: "#e9d5ff", label: "보라" },
  { v: "#e2e8f0", label: "회색" },
];

const TURN_INTO: { key: string; label: string; icon: string; run: (e: Editor) => boolean }[] = [
  { key: "p", label: "텍스트", icon: "¶", run: (e) => e.chain().setParagraph().run() },
  { key: "h1", label: "제목 1", icon: "H1", run: (e) => e.chain().setHeading({ level: 1 }).run() },
  { key: "h2", label: "제목 2", icon: "H2", run: (e) => e.chain().setHeading({ level: 2 }).run() },
  { key: "h3", label: "제목 3", icon: "H3", run: (e) => e.chain().setHeading({ level: 3 }).run() },
  { key: "ul", label: "글머리 목록", icon: "•", run: (e) => e.chain().toggleBulletList().run() },
  { key: "ol", label: "번호 목록", icon: "1.", run: (e) => e.chain().toggleOrderedList().run() },
  { key: "todo", label: "체크리스트", icon: "☑", run: (e) => e.chain().toggleTaskList().run() },
  { key: "quote", label: "인용", icon: "❝", run: (e) => e.chain().toggleBlockquote().run() },
  { key: "callout", label: "콜아웃", icon: "💡", run: (e) => e.chain().setCallout().run() },
  { key: "toggle", label: "토글", icon: "▸", run: (e) => e.chain().setDetails().run() },
  { key: "code", label: "코드", icon: "</>", run: (e) => e.chain().toggleCodeBlock().run() },
];

/** 글자가 있는 블록인지 (바꾸기·색 메뉴를 보일지) */
function isTextual(n: PMNode) {
  return !n.isAtom && !["table", "horizontalRule", "image", "embed", "fileBlock", "details"].includes(n.type.name);
}

// ---- 왼쪽 손잡이 --------------------------------------------------------------
// 고정 객체여야 함 (바뀌면 플러그인을 다시 등록해서 / 메뉴 등이 닫힘)
const HANDLE_POS = { placement: "left-start", strategy: "absolute" } as const;
export function BlockHandle({ editor }: { editor: Editor }) {
  const cur = useRef<{ node: PMNode | null; pos: number }>({ node: null, pos: -1 });
  const [menu, setMenu] = useState<{ node: PMNode; pos: number; x: number; y: number } | null>(null);
  const grip = useRef<HTMLButtonElement>(null);

  const close = () => {
    setMenu(null);
    editor.commands.setMeta("lockDragHandle", false);
  };

  const addBelow = () => {
    const { node, pos } = cur.current;
    if (!node || pos < 0) return;
    if (node.type.name === "paragraph" && node.content.size === 0) {
      editor.chain().focus().setTextSelection(pos + 1).insertContent("/").run();
      return;
    }
    const end = pos + node.nodeSize;
    editor.chain().focus().insertContentAt(end, { type: "paragraph" }).setTextSelection(end + 1).insertContent("/").run();
  };

  const openMenu = () => {
    const { node, pos } = cur.current;
    const r = grip.current?.getBoundingClientRect();
    if (!node || pos < 0 || !r) return;
    editor.commands.setMeta("lockDragHandle", true); // 메뉴가 열린 동안 손잡이 고정
    setMenu({ node, pos, x: r.left, y: r.bottom + 4 });
  };

  return (
    <>
      <DragHandle editor={editor} onNodeChange={({ node, pos }) => (cur.current = { node, pos })} computePositionConfig={HANDLE_POS}>
        <div className="npd-handle">
          <button type="button" className="npd-handle-btn" title="아래에 블록 추가 ( / 메뉴 )" onClick={addBelow} onMouseDown={(e) => e.preventDefault()}>
            +
          </button>
          <button type="button" ref={grip} className="npd-handle-btn npd-handle-grip" title="끌어서 옮기기 · 눌러서 메뉴" onClick={openMenu}>
            ⋮⋮
          </button>
        </div>
      </DragHandle>
      {menu && <BlockMenu editor={editor} {...menu} onClose={close} />}
    </>
  );
}

function BlockMenu({ editor, node, pos, x, y, onClose }: { editor: Editor; node: PMNode; pos: number; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [sub, setSub] = useState<"turn" | "color" | null>(null);
  useEffect(() => {
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    document.addEventListener("mousedown", off);
    window.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("mousedown", off);
      window.removeEventListener("keydown", esc, true);
    };
  }, [onClose]);

  const from = pos + 1;
  const to = pos + node.nodeSize - 1;
  const selectBlock = () => editor.chain().focus().setTextSelection({ from, to: Math.max(from, to) });
  const textual = isTextual(node);
  const run = (fn: () => void) => {
    fn();
    onClose();
  };
  const top = Math.min(y, window.innerHeight - 340);

  return createPortal(
    <div ref={ref} className="npd-blockmenu" style={{ left: Math.max(8, x), top: Math.max(8, top) }}>
      {textual && (
        <>
          <button type="button" onClick={() => setSub(sub === "turn" ? null : "turn")}>
            <span>🔁</span> 다른 블록으로 바꾸기 <i>›</i>
          </button>
          {sub === "turn" && (
            <div className="npd-blockmenu-sub">
              {TURN_INTO.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() =>
                    run(() => {
                      selectBlock().clearNodes().run();
                      editor.commands.setTextSelection({ from, to: Math.max(from, Math.min(to, editor.state.doc.content.size - 1)) });
                      t.run(editor);
                    })
                  }
                >
                  <span className="w-6 text-center text-[11px] text-slate-500">{t.icon}</span> {t.label}
                </button>
              ))}
            </div>
          )}
          <button type="button" onClick={() => setSub(sub === "color" ? null : "color")}>
            <span>🎨</span> 색 <i>›</i>
          </button>
          {sub === "color" && (
            <div className="npd-blockmenu-sub">
              <div className="px-2 pb-1 pt-1.5 text-[10px] text-slate-400">글자 색</div>
              <div className="flex flex-wrap gap-1 px-2">
                {TEXT_COLORS.map((c) => (
                  <button
                    key={c.v || "none"}
                    type="button"
                    title={c.label}
                    className="npd-swatch"
                    style={{ color: c.v || "#0f172a" }}
                    onClick={() => run(() => (c.v ? selectBlock().setColor(c.v).run() : selectBlock().unsetColor().run()))}
                  >
                    A
                  </button>
                ))}
              </div>
              <div className="px-2 pb-1 pt-2 text-[10px] text-slate-400">배경(형광펜)</div>
              <div className="flex flex-wrap gap-1 px-2 pb-1.5">
                {HIGHLIGHTS.map((c) => (
                  <button
                    key={c.v || "none"}
                    type="button"
                    title={c.label}
                    className="npd-swatch"
                    style={{ background: c.v || "#fff" }}
                    onClick={() => run(() => (c.v ? selectBlock().setHighlight({ color: c.v }).run() : selectBlock().unsetHighlight().run()))}
                  >
                    {c.v ? "" : "×"}
                  </button>
                ))}
              </div>
            </div>
          )}
          <hr />
        </>
      )}
      <button type="button" onClick={() => run(() => editor.chain().focus().insertContentAt(pos + node.nodeSize, node.toJSON()).run())}>
        <span>⧉</span> 복제
      </button>
      <button type="button" className="text-rose-600" onClick={() => run(() => editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run())}>
        <span>🗑</span> 삭제
      </button>
      <p className="npd-blockmenu-tip">손잡이를 끌면 블록을 옮길 수 있어요</p>
    </div>,
    document.body
  );
}

// ---- 글자를 고르면 뜨는 툴바 ----------------------------------------------------
export function SelectionBubble({ editor }: { editor: Editor }) {
  const [pop, setPop] = useState<"color" | "hl" | null>(null);
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      link: e.isActive("link"),
      h: e.isActive("heading", { level: 1 }) ? "h1" : e.isActive("heading", { level: 2 }) ? "h2" : e.isActive("heading", { level: 3 }) ? "h3" : "p",
      color: (e.getAttributes("textStyle").color as string) ?? "",
    }),
  });
  const c = () => editor.chain().focus();
  const B = ({ on, title, onClick, children }: { on?: boolean; title: string; onClick: () => void; children: React.ReactNode }) => (
    <button type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick} className={on ? "is-on" : ""}>
      {children}
    </button>
  );
  return (
    <BubbleMenu
      editor={editor}
      appendTo={() => document.body}
      options={{ placement: "top", offset: 8, strategy: "fixed" }}
      shouldShow={({ editor: e, state }) => {
        if (!e.isEditable || state.selection.empty || state.selection instanceof NodeSelection) return false;
        if (e.isActive("codeBlock")) return false;
        return true;
      }}
      className="npd-bubble"
    >
      <select
        value={s.h}
        title="블록 종류"
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "p") c().setParagraph().run();
          else c().setHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run();
        }}
      >
        <option value="p">텍스트</option>
        <option value="h1">제목 1</option>
        <option value="h2">제목 2</option>
        <option value="h3">제목 3</option>
      </select>
      <span className="npd-bubble-sep" />
      <B title="굵게 (Ctrl+B)" on={s.bold} onClick={() => c().toggleBold().run()}>
        <b>B</b>
      </B>
      <B title="기울임 (Ctrl+I)" on={s.italic} onClick={() => c().toggleItalic().run()}>
        <i className="font-serif">I</i>
      </B>
      <B title="밑줄 (Ctrl+U)" on={s.underline} onClick={() => c().toggleUnderline().run()}>
        <u>U</u>
      </B>
      <B title="취소선" on={s.strike} onClick={() => c().toggleStrike().run()}>
        <s>S</s>
      </B>
      <B title="코드" on={s.code} onClick={() => c().toggleCode().run()}>
        {"</>"}
      </B>
      <span className="npd-bubble-sep" />
      <div className="relative">
        <B title="글자 색" onClick={() => setPop(pop === "color" ? null : "color")}>
          <span style={{ color: s.color || undefined, borderBottom: `2px solid ${s.color || "#0f172a"}` }}>A</span>
        </B>
        {pop === "color" && (
          <div className="npd-bubble-pop">
            {TEXT_COLORS.map((x) => (
              <button
                key={x.v || "none"}
                type="button"
                title={x.label}
                className="npd-swatch"
                style={{ color: x.v || "#0f172a" }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => (setPop(null), x.v ? c().setColor(x.v).run() : c().unsetColor().run())}
              >
                A
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="relative">
        <B title="형광펜" onClick={() => setPop(pop === "hl" ? null : "hl")}>
          <span className="rounded px-0.5" style={{ background: "#fef08a" }}>
            ✎
          </span>
        </B>
        {pop === "hl" && (
          <div className="npd-bubble-pop">
            {HIGHLIGHTS.map((x) => (
              <button
                key={x.v || "none"}
                type="button"
                title={x.label}
                className="npd-swatch"
                style={{ background: x.v || "#fff" }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => (setPop(null), x.v ? c().setHighlight({ color: x.v }).run() : c().unsetHighlight().run())}
              >
                {x.v ? "" : "×"}
              </button>
            ))}
          </div>
        )}
      </div>
      <B
        title="링크"
        on={s.link}
        onClick={() => {
          if (s.link) return void c().unsetLink().run();
          const url = window.prompt("링크 주소", "https://");
          if (url && /^https?:\/\//i.test(url)) c().extendMarkRange("link").setLink({ href: url }).run();
        }}
      >
        🔗
      </B>
    </BubbleMenu>
  );
}
