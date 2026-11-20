"use client";

// 입력 중에 뜨는 고르기 창: / 명령어 · @사람 · [[메모·단계]]
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Extension, type Editor, type Range } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { type SuggestionOptions, type SuggestionProps } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import { supabase } from "@/lib/supabase/client";
import { today } from "@/lib/dates";

export interface SuggestItem {
  key: string;
  label: string;
  icon?: string;
  hint?: string;
  group?: string;
}

interface ListProps {
  items: SuggestItem[];
  command: (item: SuggestItem) => void;
  empty?: string;
  title?: string;
}
export interface ListHandle {
  onKeyDown: (e: KeyboardEvent) => boolean;
}

const SuggestList = forwardRef<ListHandle, ListProps>(function SuggestList({ items, command, empty, title }, ref) {
  const [i, setI] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => setI(0), [items]);
  useEffect(() => {
    box.current?.querySelector<HTMLElement>(`[data-i="${i}"]`)?.scrollIntoView({ block: "nearest" });
  }, [i]);
  useImperativeHandle(ref, () => ({
    onKeyDown: (e) => {
      if (!items.length) return false;
      if (e.key === "ArrowDown") return setI((v) => (v + 1) % items.length), true;
      if (e.key === "ArrowUp") return setI((v) => (v - 1 + items.length) % items.length), true;
      if (e.key === "Enter" || e.key === "Tab") {
        if (e.isComposing) return false;
        command(items[i]);
        return true;
      }
      return false;
    },
  }));
  let lastGroup: string | undefined;
  return (
    <div ref={box} className="npd-suggest scroll-thin" onMouseDown={(e) => e.preventDefault()}>
      {title && <div className="npd-suggest-title">{title}</div>}
      {items.length === 0 ? (
        <div className="npd-suggest-empty">{empty ?? "맞는 항목이 없습니다"}</div>
      ) : (
        items.map((it, idx) => {
          const head = it.group && it.group !== lastGroup ? it.group : null;
          lastGroup = it.group;
          return (
            <div key={it.key}>
              {head && <div className="npd-suggest-title">{head}</div>}
              <button type="button" data-i={idx} className={idx === i ? "is-active" : ""} onMouseEnter={() => setI(idx)} onClick={() => command(it)}>
                {it.icon && <span className="npd-suggest-ico">{it.icon}</span>}
                <span className="npd-suggest-label">{it.label}</span>
                {it.hint && <span className="npd-suggest-hint">{it.hint}</span>}
              </button>
            </div>
          );
        })
      )}
    </div>
  );
});

/** 고르기 창 그리기 (화면 고정 위치, 큰 창 위에도 보이게) */
function renderer(extra: { empty?: string; title?: string } = {}) {
  return () => {
    let comp: ReactRenderer<ListHandle, ListProps> | null = null;
    let el: HTMLElement | null = null;
    const place = (rect: (() => DOMRect | null) | null | undefined) => {
      const r = rect?.();
      if (!r || !el) return;
      computePosition({ getBoundingClientRect: () => r }, el, { strategy: "fixed", placement: "bottom-start", middleware: [offset(6), flip(), shift({ padding: 8 })] }).then(({ x, y }) => {
        if (el) Object.assign(el.style, { left: `${x}px`, top: `${y}px` });
      });
    };
    return {
      onStart: (props: SuggestionProps<SuggestItem>) => {
        comp = new ReactRenderer(SuggestList, { props: { ...props, ...extra }, editor: props.editor });
        el = comp.element as HTMLElement;
        Object.assign(el.style, { position: "fixed", zIndex: "90", left: "-9999px", top: "0" });
        document.body.appendChild(el);
        place(props.clientRect);
      },
      onUpdate: (props: SuggestionProps<SuggestItem>) => {
        comp?.updateProps({ ...props, ...extra });
        place(props.clientRect);
      },
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (event.key === "Escape") {
          el?.remove();
          return true;
        }
        return comp?.ref?.onKeyDown(event) ?? false;
      },
      onExit: () => {
        el?.remove();
        comp?.destroy();
        comp = null;
        el = null;
      },
    };
  };
}

// ---- / 명령어 ---------------------------------------------------------------
type Run = (e: Editor, r: Range) => void;
interface SlashItem extends SuggestItem {
  kw: string;
  run: Run;
}

/** 편집기 바깥 기능(파일 고르기 등)을 / 명령어에서 부르기 위한 자리 */
export interface NpdBlocksStorage {
  pickFile: (() => void) | null;
}
export const NpdBlocks = Extension.create<object, NpdBlocksStorage>({
  name: "npdBlocks",
  addStorage() {
    return { pickFile: null };
  },
});
const npd = (e: Editor) => (e.storage as unknown as { npdBlocks?: NpdBlocksStorage }).npdBlocks;

export const SLASH_ITEMS: SlashItem[] = [
  { key: "p", group: "기본", icon: "¶", label: "텍스트", hint: "일반 글", kw: "text paragraph 텍스트 본문 글", run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
  { key: "h1", group: "기본", icon: "H1", label: "제목 1", hint: "#", kw: "h1 heading title 제목 큰", run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run() },
  { key: "h2", group: "기본", icon: "H2", label: "제목 2", hint: "##", kw: "h2 heading 제목 중간", run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run() },
  { key: "h3", group: "기본", icon: "H3", label: "제목 3", hint: "###", kw: "h3 heading 제목 작은", run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run() },
  { key: "ul", group: "기본", icon: "•", label: "글머리 목록", hint: "-", kw: "bullet list ul 목록 글머리", run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { key: "ol", group: "기본", icon: "1.", label: "번호 목록", hint: "1.", kw: "number ordered list ol 번호 목록", run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { key: "todo", group: "기본", icon: "☑", label: "체크리스트", hint: "[]", kw: "todo task check 할일 체크 체크박스", run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  { key: "toggle", group: "블록", icon: "▸", label: "토글", hint: "접고 펼치기", kw: "toggle details 토글 접기 펼치기", run: (e, r) => e.chain().focus().deleteRange(r).setDetails().run() },
  { key: "callout", group: "블록", icon: "💡", label: "콜아웃", hint: "강조 상자", kw: "callout 콜아웃 강조 박스 상자 주의", run: (e, r) => e.chain().focus().deleteRange(r).setCallout().run() },
  { key: "quote", group: "블록", icon: "❝", label: "인용", hint: ">", kw: "quote blockquote 인용", run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { key: "hr", group: "블록", icon: "—", label: "구분선", hint: "---", kw: "divider hr line 구분선 선", run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
  { key: "code", group: "블록", icon: "</>", label: "코드", hint: "```", kw: "code 코드", run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  { key: "table", group: "블록", icon: "▦", label: "표", hint: "3×3", kw: "table 표 테이블", run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  {
    key: "file",
    group: "넣기",
    icon: "🖼️",
    label: "이미지·파일",
    hint: "붙여넣기·끌어놓기도 돼요",
    kw: "image file photo 이미지 사진 파일 첨부 그림",
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      npd(e)?.pickFile?.();
    },
  },
  {
    key: "embed",
    group: "넣기",
    icon: "▶",
    label: "임베드 · 북마크",
    hint: "유튜브·구글 드라이브·웹 주소",
    kw: "embed youtube drive bookmark link 임베드 유튜브 영상 드라이브 북마크 링크 주소",
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      const url = window.prompt("유튜브·구글 드라이브·웹 주소를 붙여넣으세요", "https://");
      if (url && /^https?:\/\/\S+/.test(url.trim())) e.chain().focus().setEmbed(url.trim()).run();
    },
  },
  { key: "mention", group: "넣기", icon: "@", label: "사람 언급", hint: "@", kw: "mention person people 사람 언급 멘션", run: (e, r) => e.chain().focus().deleteRange(r).insertContent("@").run() },
  { key: "ref", group: "넣기", icon: "📄", label: "메모·단계 링크", hint: "[[", kw: "link page note stage 링크 메모 단계 페이지", run: (e, r) => e.chain().focus().deleteRange(r).insertContent("[[").run() },
  { key: "date", group: "넣기", icon: "📅", label: "오늘 날짜", kw: "date today 날짜 오늘", run: (e, r) => e.chain().focus().deleteRange(r).insertContent(today().replace(/-/g, ".") + " ").run() },
];

export const SlashCommand = Extension.create({
  name: "slashCommand",
  addProseMirrorPlugins() {
    return [
      Suggestion<SuggestItem>({
        editor: this.editor,
        pluginKey: new PluginKey("slashCommand"),
        char: "/",
        allowSpaces: false,
        startOfLine: false,
        // 표·코드 안에서는 쓰지 않음
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          for (let d = $from.depth; d > 0; d--) if (["codeBlock", "table"].includes($from.node(d).type.name)) return false;
          return true;
        },
        items: ({ query }) => {
          const q = query.trim().toLowerCase();
          return (q ? SLASH_ITEMS.filter((x) => x.label.toLowerCase().includes(q) || x.kw.toLowerCase().includes(q)) : SLASH_ITEMS).slice(0, 30);
        },
        command: ({ editor, range, props }) => (props as SlashItem).run(editor, range),
        render: renderer({ empty: "맞는 블록이 없습니다" }),
      }),
    ];
  },
});

// ---- @사람 -------------------------------------------------------------------
export interface PersonLite {
  id: string;
  label: string;
  hint?: string;
}

export function personSuggestion(getPeople: () => PersonLite[]): Omit<SuggestionOptions<SuggestItem>, "editor"> {
  return {
    char: "@",
    pluginKey: new PluginKey("personMention"),
    items: ({ query }) => {
      const q = query.trim().toLowerCase();
      return getPeople()
        .filter((p) => !q || p.label.toLowerCase().includes(q) || (p.hint ?? "").toLowerCase().includes(q))
        .slice(0, 8)
        .map((p) => ({ key: p.id, label: p.label, hint: p.hint, icon: "👤" }));
    },
    command: ({ editor, range, props }) => {
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          { type: "mention", attrs: { id: props.key, label: props.label } },
          { type: "text", text: " " },
        ])
        .run();
    },
    render: renderer({ title: "사람 언급", empty: "맞는 사람이 없습니다" }),
  };
}

// ---- [[메모·단계]] ------------------------------------------------------------
interface RefRow extends SuggestItem {
  kind: "note" | "stage";
  href: string;
}
let refCache: { at: number; rows: RefRow[] } | null = null;
async function loadRefs(): Promise<RefRow[]> {
  if (refCache && Date.now() - refCache.at < 60_000) return refCache.rows;
  const sb = supabase();
  const notesQ = async () => {
    const r = await sb.from("notes").select("id,title,icon,is_template,deleted_at").order("updated_at", { ascending: false }).limit(500);
    if (!r.error) return ((r.data ?? []) as { id: string; title: string; icon: string | null; is_template: boolean; deleted_at: string | null }[]).filter((n) => !n.is_template && !n.deleted_at);
    const r2 = await sb.from("notes").select("id,title").order("updated_at", { ascending: false }).limit(500); // 016 전
    return ((r2.data ?? []) as { id: string; title: string }[]).map((n) => ({ ...n, icon: null }));
  };
  const [notes, st, pj] = await Promise.all([
    notesQ(),
    sb.from("stages").select("id,name,project_id,ref_code").order("sort_order"),
    sb.from("projects").select("id,name,archived"),
  ]);
  const pname = Object.fromEntries(((pj.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const rows: RefRow[] = [
    ...notes.map((n) => ({ key: `note:${n.id}`, kind: "note" as const, label: n.title || "제목 없음", icon: n.icon || "📄", group: "메모", href: `/notes?id=${n.id}` })),
    ...((st.data ?? []) as { id: string; name: string; project_id: string; ref_code: string | null }[]).map((s) => ({
      key: `stage:${s.id}`,
      kind: "stage" as const,
      label: s.name,
      hint: pname[s.project_id] ?? "",
      icon: "◆",
      group: "프로젝트 단계",
      href: s.ref_code ? `/s/${s.ref_code}` : `/projects/${s.project_id}?stage=${s.id}`,
    })),
  ];
  refCache = { at: Date.now(), rows };
  return rows;
}
export function forgetRefCache() {
  refCache = null;
}

export function refSuggestion(): Omit<SuggestionOptions<SuggestItem>, "editor"> {
  return {
    char: "[[",
    pluginKey: new PluginKey("refLink"),
    allowSpaces: true,
    items: async ({ query }) => {
      const q = query.replace(/\]+$/, "").trim().toLowerCase();
      const rows = await loadRefs();
      const hit = (r: RefRow) => !q || r.label.toLowerCase().includes(q) || (r.hint ?? "").toLowerCase().includes(q);
      return [...rows.filter((r) => r.kind === "note" && hit(r)).slice(0, 6), ...rows.filter((r) => r.kind === "stage" && hit(r)).slice(0, 6)];
    },
    command: ({ editor, range, props }) => {
      const r = props as RefRow;
      const [, id] = r.key.split(":");
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          { type: "ref", attrs: { id, label: r.label, kind: r.kind, href: r.href } },
          { type: "text", text: " " },
        ])
        .run();
    },
    render: renderer({ empty: "맞는 메모·단계가 없습니다" }),
  };
}

/** 쓰지 않는 편집기(작은 칸)용: 고르기 창이 안 뜨게 */
export function disabledSuggestion(char: string, key: string): Omit<SuggestionOptions<SuggestItem>, "editor"> {
  return { char, pluginKey: new PluginKey(key), allow: () => false, items: () => [] };
}
