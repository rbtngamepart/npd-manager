"use client";

// 서식 있는 메모: 굵게·기울임·밑줄·취소선, 글자 크기·색, 글머리 기호·번호, 체크박스, 링크
import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Color, FontSize, TextStyle } from "@tiptap/extension-text-style";
import { Placeholder } from "@tiptap/extension-placeholder";
import DOMPurify from "dompurify";

const SIZES = [
  { v: "", label: "보통" },
  { v: "12px", label: "작게" },
  { v: "17px", label: "크게" },
  { v: "21px", label: "아주 크게" },
];

const COLORS = [
  { v: "", label: "기본" },
  { v: "#e11d48", label: "빨강" },
  { v: "#d97706", label: "주황" },
  { v: "#059669", label: "초록" },
  { v: "#2563eb", label: "파랑" },
  { v: "#7c3aed", label: "보라" },
  { v: "#64748b", label: "회색" },
];

/** 비어 있는 편집기 결과 */
export function isEmptyHtml(html: string | null | undefined): boolean {
  if (!html) return true;
  if (/<input[^>]+type="checkbox"/i.test(html) || /<img/i.test(html)) return false;
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim() === "";
}

/** HTML → 검색·내보내기용 글자 (체크박스는 ☐/☑, 목록은 •) */
export function htmlToText(html: string): string {
  if (typeof window === "undefined") return html.replace(/<[^>]+>/g, " ");
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: string[] = [];
  const walk = (el: Element, prefix = "") => {
    for (const node of Array.from(el.children)) {
      const tag = node.tagName.toLowerCase();
      if (tag === "ul" || tag === "ol") {
        const task = node.getAttribute("data-type") === "taskList";
        Array.from(node.children).forEach((li, i) => {
          const mark = task ? (li.getAttribute("data-checked") === "true" ? "☑ " : "☐ ") : tag === "ol" ? `${i + 1}. ` : "• ";
          const body = li.querySelector(":scope > div") ?? li;
          const first = Array.from(body.children).find((c) => !["UL", "OL"].includes(c.tagName));
          out.push(prefix + mark + (first?.textContent ?? body.textContent ?? "").trim());
          Array.from(body.children)
            .filter((c) => ["UL", "OL"].includes(c.tagName))
            .forEach((sub) => walk({ children: [sub] } as unknown as Element, prefix + "  "));
        });
      } else if (tag === "p" || /^h[1-6]$/.test(tag) || tag === "blockquote" || tag === "pre") {
        out.push(prefix + (node.textContent ?? ""));
      } else {
        walk(node, prefix);
      }
    }
  };
  walk(doc.body);
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** 글자 → 편집기용 HTML (예전 기록·글자만 있는 칸) */
export function textToHtml(text: string | null | undefined): string {
  if (!text) return "";
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .split("\n")
    .map((l) => `<p>${esc(l) || "<br>"}</p>`)
    .join("");
}

export function sanitize(html: string): string {
  // 서버에서 그릴 때는 비워 두고 브라우저에서 채움
  if (typeof window === "undefined" || typeof DOMPurify.sanitize !== "function") return "";
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ["target", "data-type", "data-checked"],
    FORBID_TAGS: ["style", "script", "iframe", "form", "button", "textarea", "select"],
  });
}

function Btn({ on, title, onClick, children, disabled }: { on?: boolean; title: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`grid h-7 min-w-7 place-items-center rounded px-1.5 text-xs disabled:opacity-30 ${on ? "bg-ink text-white" : "text-slate-600 hover:bg-black/[0.06]"}`}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      link: e.isActive("link"),
      size: (e.getAttributes("textStyle").fontSize as string) ?? "",
      color: (e.getAttributes("textStyle").color as string) ?? "",
    }),
  });
  const c = () => editor.chain().focus();
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-black/[0.06] px-1.5 py-1">
      <select
        className="h-7 rounded border-0 bg-transparent px-1 text-xs text-slate-600 hover:bg-black/[0.06]"
        title="글자 크기"
        value={s.size}
        onChange={(e) => (e.target.value ? c().setFontSize(e.target.value).run() : c().unsetFontSize().run())}
      >
        {SIZES.map((x) => (
          <option key={x.v} value={x.v}>
            {x.label}
          </option>
        ))}
      </select>
      <Btn title="굵게 (Ctrl+B)" on={s.bold} onClick={() => c().toggleBold().run()}>
        <b>B</b>
      </Btn>
      <Btn title="기울임 (Ctrl+I)" on={s.italic} onClick={() => c().toggleItalic().run()}>
        <i className="font-serif">I</i>
      </Btn>
      <Btn title="밑줄 (Ctrl+U)" on={s.underline} onClick={() => c().toggleUnderline().run()}>
        <u>U</u>
      </Btn>
      <Btn title="취소선" on={s.strike} onClick={() => c().toggleStrike().run()}>
        <s>S</s>
      </Btn>
      <label className="relative grid h-7 w-7 cursor-pointer place-items-center rounded hover:bg-black/[0.06]" title="글자 색">
        <span className="text-xs font-semibold" style={{ color: s.color || undefined, borderBottom: `3px solid ${s.color || "#0f172a"}` }}>
          A
        </span>
        <select
          className="absolute inset-0 cursor-pointer opacity-0"
          value={s.color}
          onChange={(e) => (e.target.value ? c().setColor(e.target.value).run() : c().unsetColor().run())}
        >
          {COLORS.map((x) => (
            <option key={x.v} value={x.v}>
              {x.label}
            </option>
          ))}
        </select>
      </label>
      <span className="mx-1 h-4 w-px bg-black/10" />
      <Btn title="글머리 기호" on={s.bullet} onClick={() => c().toggleBulletList().run()}>
        •≡
      </Btn>
      <Btn title="번호 목록" on={s.ordered} onClick={() => c().toggleOrderedList().run()}>
        1.
      </Btn>
      <Btn title="체크박스" on={s.task} onClick={() => c().toggleTaskList().run()}>
        ☑
      </Btn>
      <Btn
        title="들여쓰기 (Tab)"
        disabled={!(s.bullet || s.ordered || s.task)}
        onClick={() => (s.task ? c().sinkListItem("taskItem").run() : c().sinkListItem("listItem").run())}
      >
        →
      </Btn>
      <Btn
        title="내어쓰기 (Shift+Tab)"
        disabled={!(s.bullet || s.ordered || s.task)}
        onClick={() => (s.task ? c().liftListItem("taskItem").run() : c().liftListItem("listItem").run())}
      >
        ←
      </Btn>
      <span className="mx-1 h-4 w-px bg-black/10" />
      <Btn
        title="링크"
        on={s.link}
        onClick={() => {
          if (s.link) return void c().unsetLink().run();
          const url = prompt("링크 주소", "https://");
          if (url && /^https?:\/\//i.test(url)) c().extendMarkRange("link").setLink({ href: url }).run();
        }}
      >
        🔗
      </Btn>
      <Btn title="서식 지우기" onClick={() => c().unsetAllMarks().clearNodes().run()}>
        ⌫
      </Btn>
    </div>
  );
}

export function RichEditor({
  value,
  onChange,
  placeholder,
  onSubmit,
  disabled,
  minHeight = 80,
  autoFocus,
  resetKey,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** Ctrl+Enter */
  onSubmit?: () => void;
  disabled?: boolean;
  minHeight?: number;
  autoFocus?: boolean;
  /** 바뀌면 내용을 value로 다시 채움 */
  resetKey?: string | number;
}) {
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  // 사람이 직접 고칠 때만 변경으로 알림 (편집기가 처음 열리며 내용을 정리하는 것은 무시)
  const touched = useRef(false);
  const touch = () => {
    touched.current = true;
  };

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    autofocus: autoFocus ? "end" : false,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: "https", HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" } },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TextStyle,
      FontSize,
      Color,
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: value || "",
    editorProps: {
      attributes: { class: "rich min-w-0 px-3 py-2 text-sm outline-none", style: `min-height:${minHeight}px` },
      handleKeyDown: (_v, e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && submitRef.current) {
          submitRef.current();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => {
      if (!touched.current) return;
      changeRef.current(e.isEmpty ? "" : e.getHTML());
    },
  });

  useEffect(() => {
    if (!editor) return;
    touched.current = false;
    if ((editor.isEmpty ? "" : editor.getHTML()) !== (value || "")) editor.commands.setContent(value || "", { emitUpdate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, resetKey]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  if (disabled) return <RichView html={value} className="rounded-lg border border-black/10 bg-slate-50/60 px-3 py-2" />;

  return (
    <div
      className="overflow-hidden rounded-lg border border-black/15 bg-white focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/15"
      onKeyDownCapture={touch}
      onMouseDownCapture={touch}
      onPasteCapture={touch}
      onDropCapture={touch}
      onInputCapture={touch}
      onCompositionStartCapture={touch}
      onChangeCapture={touch}
    >
      {editor && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}

/** 저장된 서식 보기. onChange를 주면 체크박스를 눌러 바꿀 수 있음 */
export function RichView({ html, onChange, className = "" }: { html: string | null | undefined; onChange?: (html: string) => void; className?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const clean = useMemo(() => (mounted ? sanitize(html ?? "") : ""), [html, mounted]);
  const ref = useRef<HTMLDivElement>(null);

  // 화면용: 체크박스 상태를 data-checked에 맞추고, 바꿀 수 없으면 잠금
  useEffect(() => {
    ref.current?.querySelectorAll<HTMLInputElement>('li[data-type="taskItem"] input[type="checkbox"]').forEach((cb) => {
      const li = cb.closest("li");
      cb.checked = li?.getAttribute("data-checked") === "true";
      cb.disabled = !onChange;
    });
  }, [clean, onChange]);

  function onClick(e: React.MouseEvent) {
    const t = e.target as HTMLElement;
    if (!onChange || !(t instanceof HTMLInputElement) || t.type !== "checkbox") return;
    const all = Array.from(ref.current?.querySelectorAll('li[data-type="taskItem"]') ?? []);
    const idx = all.indexOf(t.closest("li") as Element);
    if (idx < 0) return;
    const doc = new DOMParser().parseFromString(clean, "text/html");
    const li = doc.querySelectorAll('li[data-type="taskItem"]')[idx];
    if (!li) return;
    const next = li.getAttribute("data-checked") !== "true";
    li.setAttribute("data-checked", String(next));
    const input = li.querySelector('input[type="checkbox"]');
    if (next) input?.setAttribute("checked", "checked");
    else input?.removeAttribute("checked");
    onChange(doc.body.innerHTML);
  }

  if (isEmptyHtml(clean)) return null;
  return <div ref={ref} onClick={onClick} className={`rich text-sm ${className}`} dangerouslySetInnerHTML={{ __html: clean }} />;
}
