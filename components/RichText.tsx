"use client";

// 서식 있는 메모: 굵게·기울임·밑줄·취소선, 글자 크기·색, 글머리 기호·번호, 체크박스, 링크
//   + 제목·토글·콜아웃·표·이미지·파일·임베드·@사람·[[링크]] (모든 편집기가 같은 형식을 읽음)
//   blocks: 큰 편집기에서만 노션식 도구(⋮⋮ 손잡이, / 명령어, 고르면 뜨는 툴바, 파일 붙여넣기)
import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Color, FontSize, TextStyle } from "@tiptap/extension-text-style";
import { Placeholder } from "@tiptap/extension-placeholder";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import { TableKit } from "@tiptap/extension-table";
import FileHandler from "@tiptap/extension-file-handler";
import DOMPurify from "dompurify";
import { useApp, displayName } from "./AppProvider";
import { Callout, Embed, FileBlock, FileImage, PersonMention, RefLink } from "./editor/nodes";
import { NpdBlocks, SlashCommand, disabledSuggestion, personSuggestion, refSuggestion, type NpdBlocksStorage, type PersonLite } from "./editor/suggest";
import { BlockHandle, SelectionBubble } from "./editor/BlockUI";
import { embedFor, hydrateRich, openFile, uploadFile } from "./editor/files";

const SIZES = [
  { v: "", label: "보통" },
  { v: "12px", label: "작게" },
  { v: "17px", label: "크게" },
  { v: "21px", label: "아주 크게" },
];

/** Ctrl+1~4 순서: 보통 · 작게 · 크게 · 아주 크게 */
const SIZE_KEYS = ["", "12px", "17px", "21px"];

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
  if (/<input[^>]+type="checkbox"/i.test(html) || /<img|<hr|<table|data-type="(embed|file|mention|ref)"/i.test(html)) return false;
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
      } else if (tag === "p" || /^h[1-6]$/.test(tag) || tag === "pre" || tag === "summary") {
        out.push(prefix + (node.textContent ?? ""));
      } else if (tag === "tr") {
        out.push(prefix + Array.from(node.children).map((c) => (c.textContent ?? "").trim()).join(" | "));
      } else if (tag === "hr") {
        out.push(prefix + "———");
      } else if (node.children.length === 0 && (node.textContent ?? "").trim()) {
        out.push(prefix + (node.textContent ?? "").trim());
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
    ADD_ATTR: ["target", "data-type", "data-checked", "open"],
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

function Toolbar({ editor, blocks, uploading, onPick }: { editor: Editor; blocks?: boolean; uploading?: number; onPick?: () => void }) {
  const [help, setHelp] = useState(false);
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
      align: (["center", "right"] as const).find((a) => e.isActive({ textAlign: a })) ?? "left",
      size: (e.getAttributes("textStyle").fontSize as string) ?? "",
      color: (e.getAttributes("textStyle").color as string) ?? "",
    }),
  });
  const c = () => editor.chain().focus();
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-black/[0.06] bg-white px-1.5 py-1">
      <select
        className="h-7 rounded border-0 bg-transparent px-1 text-xs text-slate-600 hover:bg-black/[0.06]"
        title="글자 크기 · Ctrl+1 보통 · Ctrl+2 작게 · Ctrl+3 크게 · Ctrl+4 아주 크게"
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
      {blocks && (
        <>
          <span className="mx-1 h-4 w-px bg-black/10" />
          <Btn title="정렬 (왼쪽 → 가운데 → 오른쪽)" onClick={() => c().setTextAlign(s.align === "left" ? "center" : s.align === "center" ? "right" : "left").run()}>
            {s.align === "center" ? "≡" : s.align === "right" ? "⫸" : "⫷"}
          </Btn>
          <Btn title="표 넣기" onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
            ▦
          </Btn>
          <Btn title="이미지·파일 넣기 (붙여넣기·끌어놓기도 돼요)" onClick={() => onPick?.()}>
            🖼️
          </Btn>
          {editor.isActive("table") && <TableTools editor={editor} />}
          {!!uploading && <span className="ml-1 animate-pulse text-[11px] text-brand-600">올리는 중… {uploading}</span>}
          <div className="relative ml-auto">
            <Btn title="단축키·사용법" on={help} onClick={() => setHelp((v) => !v)}>
              ?
            </Btn>
            {help && <ShortcutHelp onClose={() => setHelp(false)} />}
          </div>
        </>
      )}
    </div>
  );
}

function TableTools({ editor }: { editor: Editor }) {
  const c = () => editor.chain().focus();
  return (
    <span className="ml-1 flex items-center gap-0.5 rounded bg-slate-100 px-1 text-[11px] text-slate-600">
      표:
      <Btn title="아래에 줄 추가" onClick={() => c().addRowAfter().run()}>
        +줄
      </Btn>
      <Btn title="오른쪽에 칸 추가" onClick={() => c().addColumnAfter().run()}>
        +칸
      </Btn>
      <Btn title="이 줄 지우기" onClick={() => c().deleteRow().run()}>
        −줄
      </Btn>
      <Btn title="이 칸 지우기" onClick={() => c().deleteColumn().run()}>
        −칸
      </Btn>
      <Btn title="첫 줄을 머리글로 켜기/끄기" onClick={() => c().toggleHeaderRow().run()}>
        머리글
      </Btn>
      <Btn title="표 지우기" onClick={() => c().deleteTable().run()}>
        🗑
      </Btn>
    </span>
  );
}

const SHORTCUTS: [string, string][] = [
  ["/", "블록 메뉴 (제목·토글·표·이미지…)"],
  ["# · ## · ###", "제목 1 · 2 · 3"],
  ["- 또는 *", "글머리 목록"],
  ["1.", "번호 목록"],
  ["[] ", "체크리스트"],
  ["> ", "인용"],
  ["---", "구분선"],
  ["```", "코드"],
  ["**글자**", "굵게"],
  ["@", "사람 언급"],
  ["[[", "메모·단계 링크"],
  ["Ctrl+1~4", "글자 크기"],
  ["Tab / Shift+Tab", "목록 들여쓰기 / 내어쓰기"],
  ["⋮⋮ 끌기", "블록 옮기기 (누르면 메뉴)"],
  ["주소 붙여넣기", "빈 줄에 유튜브·구글 드라이브 → 바로 보기"],
];
function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [onClose]);
  return (
    <div ref={ref} className="absolute right-0 top-full z-40 mt-1 w-72 rounded-lg border border-black/10 bg-white p-2 text-xs shadow-lg">
      <p className="px-1 pb-1.5 font-semibold text-slate-700">입력하면 바로 바뀌어요</p>
      <table className="w-full">
        <tbody>
          {SHORTCUTS.map(([k, v]) => (
            <tr key={k}>
              <td className="whitespace-nowrap py-0.5 pr-2 align-top">
                <code className="rounded bg-slate-100 px-1 text-[11px]">{k}</code>
              </td>
              <td className="py-0.5 text-slate-600">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
  large,
  fill,
  blocks,
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
  /** 큰 창용: 글자를 조금 크게 */
  large?: boolean;
  /** 부모 높이를 채우고, 글이 길어지면 본문만 스크롤 (도구 줄은 위에 고정) */
  fill?: boolean;
  /** 노션식 도구 켜기 (메모·큰 창) */
  blocks?: boolean;
}) {
  const { profiles } = useApp();
  const peopleRef = useRef<PersonLite[]>([]);
  peopleRef.current = useMemo(
    () => (profiles ?? []).filter((p) => p.approved).map((p) => ({ id: p.id, label: displayName(p), hint: p.department ?? "" })),
    [profiles]
  );
  const [uploading, setUploading] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
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
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, defaultProtocol: "https", HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" } },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TextStyle,
      FontSize,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Details.configure({ persist: true, HTMLAttributes: { class: "npd-details" } }),
      DetailsSummary,
      DetailsContent,
      TableKit.configure({ table: { resizable: false } }),
      Callout,
      FileImage,
      FileBlock,
      Embed,
      PersonMention.configure({ suggestion: blocks ? personSuggestion(() => peopleRef.current) : disabledSuggestion("@", "mention-off") }),
      RefLink.configure({ suggestion: blocks ? refSuggestion() : disabledSuggestion("[[", "ref-off") }),
      Placeholder.configure({
        includeChildren: false,
        placeholder: ({ node, editor: ed }) => {
          if (node.type.name === "heading") return `제목 ${node.attrs.level}`;
          if (node.type.name === "detailsSummary") return "토글 제목";
          if (ed.isEmpty) return placeholder ?? "";
          return blocks ? "' / ' 를 입력해 블록 추가" : "";
        },
      }),
      ...(blocks
        ? [
            NpdBlocks,
            SlashCommand,
            FileHandler.configure({
              onPaste: (ed, files) => void insertFiles(ed, files),
              onDrop: (ed, files, pos) => void insertFiles(ed, files, pos),
            }),
          ]
        : []),
    ],
    content: value || "",
    editorProps: {
      attributes: {
        class: `rich min-w-0 outline-none ${large ? "py-3 text-[15px] leading-relaxed" : "py-2 text-sm"} ${blocks ? "rich-blocks pl-12 pr-5" : large ? "px-4" : "px-3"}`,
        style: `min-height:${minHeight}px`,
      },
      // 빈 줄에 유튜브·구글 드라이브 주소만 붙여넣으면 바로 보이게
      handlePaste: (view, e) => {
        if (!blocks) return false;
        const text = e.clipboardData?.getData("text/plain")?.trim() ?? "";
        if (!text || /\s/.test(text) || !/^https?:\/\//.test(text)) return false;
        const info = embedFor(text);
        const { $from, empty } = view.state.selection;
        if (!info?.iframe || !empty || $from.parent.type.name !== "paragraph" || $from.parent.content.size > 0) return false;
        touch();
        editorRef.current?.chain().focus().setEmbed(text).run();
        return true;
      },
      handleKeyDown: (_v, e) => {
        // 글자 크기 단축키: Ctrl+1 보통 · Ctrl+2 작게 · Ctrl+3 크게 · Ctrl+4 아주 크게 (Ctrl+Alt+숫자도 같음)
        const m = /^Digit([1-4])$/.exec(e.code);
        if (m && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
          const size = SIZE_KEYS[Number(m[1]) - 1];
          const ed = editorRef.current;
          if (ed) {
            touch();
            if (size) ed.chain().focus().setFontSize(size).run();
            else ed.chain().focus().unsetFontSize().run();
          }
          e.preventDefault();
          return true;
        }
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

  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  async function insertFiles(ed: Editor, files: File[], pos?: number) {
    touch();
    setUploading((n) => n + files.length);
    for (const f of files) {
      try {
        const up = await uploadFile(f);
        const node = /^image\//.test(f.type) ? { type: "image", attrs: { path: up.path, alt: f.name } } : { type: "fileBlock", attrs: up };
        if (pos !== undefined) ed.chain().focus().insertContentAt(pos, node).run();
        else ed.chain().focus().insertContent(node).run();
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err));
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  useEffect(() => {
    if (!editor || !blocks) return;
    const st = (editor.storage as unknown as { npdBlocks?: NpdBlocksStorage }).npdBlocks;
    if (st) st.pickFile = () => fileInput.current?.click();
  }, [editor, blocks]);

  useEffect(() => {
    if (!editor) return;
    touched.current = false;
    // 그림·임베드 같은 블록이 React로 그려지므로, 렌더링이 끝난 뒤에 채움
    const v = value || "";
    queueMicrotask(() => {
      if (editor.isDestroyed) return;
      if ((editor.isEmpty ? "" : editor.getHTML()) !== v) editor.commands.setContent(v, { emitUpdate: false });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, resetKey]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  if (disabled) return <RichView html={value} className="rounded-lg border border-black/10 bg-slate-50/60 px-3 py-2" />;

  return (
    <div
      className={`overflow-hidden rounded-lg border border-black/15 bg-white focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/15 ${fill ? "flex h-full min-h-0 flex-col" : ""}`}
      onKeyDownCapture={touch}
      onMouseDownCapture={touch}
      onPasteCapture={touch}
      onDropCapture={touch}
      onInputCapture={touch}
      onCompositionStartCapture={touch}
      onChangeCapture={touch}
    >
      {editor && <Toolbar editor={editor} blocks={blocks} uploading={uploading} onPick={() => fileInput.current?.click()} />}
      {blocks && editor && (
        <>
          <BlockHandle editor={editor} />
          <SelectionBubble editor={editor} />
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length) void insertFiles(editor, files);
            }}
          />
        </>
      )}
      {fill ? (
        <div
          className="scroll-thin relative min-h-0 flex-1 cursor-text overflow-y-auto"
          onMouseDown={(e) => {
            // 글 아래 빈 곳을 눌러도 이어서 쓰기
            if (e.target !== e.currentTarget || !editor) return;
            e.preventDefault();
            editor.commands.focus("end");
          }}
        >
          <EditorContent editor={editor} />
        </div>
      ) : (
        <div className="relative">
          <EditorContent editor={editor} />
        </div>
      )}
    </div>
  );
}

/** 저장된 서식 보기. onChange를 주면 체크박스를 눌러 바꿀 수 있음 */
export function RichView({ html, onChange, className = "" }: { html: string | null | undefined; onChange?: (html: string) => void; className?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const clean = useMemo(() => (mounted ? sanitize(html ?? "") : ""), [html, mounted]);
  const ref = useRef<HTMLDivElement>(null);

  // 이미지·임베드 보이게
  useEffect(() => {
    if (ref.current) hydrateRich(ref.current);
  }, [clean]);

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
    const file = t.closest?.('div[data-type="file"]');
    if (file) {
      e.preventDefault();
      const path = file.getAttribute("data-path");
      if (path) openFile(path);
      return;
    }
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
