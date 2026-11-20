"use client";

// 단계 상세: 이 단계에 연결된 메모 (메모 화면에서 연결)
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import type { Note } from "@/lib/types";

type Row = Pick<Note, "id" | "title" | "kind" | "category" | "note_date" | "visibility" | "icon" | "stage_ids">;
const CAT: Record<string, string> = { meeting: "회의", idea: "아이디어", memo: "메모" };

export function StageNotes({ projectId, stageId, canEdit }: { projectId: string; stageId: string; canEdit: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let dead = false;
    const load = async () => {
      // 016 뒤: 연결한 메모 + 본문에 [[이 단계]]를 적은 메모, 휴지통·템플릿 제외
      const plus = await supabase()
        .from("notes")
        .select("id,title,kind,category,note_date,visibility,icon,deleted_at,is_template,stage_ids")
        .or(`stage_ids.cs.{${stageId}},ref_stage_ids.cs.{${stageId}}`)
        .order("note_date", { ascending: false });
      if (!plus.error) {
        if (!dead) setRows(((plus.data ?? []) as (Row & { deleted_at: string | null; is_template: boolean })[]).filter((n) => !n.deleted_at && !n.is_template));
        return;
      }
      const { data, error } = await supabase()
        .from("notes")
        .select("id,title,kind,category,note_date,visibility")
        .contains("stage_ids", [stageId])
        .order("note_date", { ascending: false });
      if (!dead) setRows(error ? null : ((data ?? []) as Row[]));
    };
    load();
    window.addEventListener("focus", load);
    return () => {
      dead = true;
      window.removeEventListener("focus", load);
    };
  }, [stageId]);

  if (rows === null) return null; // DB 업데이트(014) 전
  return (
    <section className="space-y-2" data-tour="sp-notes">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold text-slate-700">메모 {rows.length > 0 && <span className="font-normal text-slate-400">{rows.length}</span>}</h3>
        {canEdit && (
          <span className="ml-auto flex gap-1">
            <Link href={`/notes?new=doc&project=${projectId}&stage=${stageId}`} className="rounded px-1.5 py-0.5 text-[11px] text-brand-600 hover:bg-brand-500/10">
              + 문서
            </Link>
            <Link href={`/notes?new=mindmap&project=${projectId}&stage=${stageId}`} className="rounded px-1.5 py-0.5 text-[11px] text-brand-600 hover:bg-brand-500/10">
              + 마인드맵
            </Link>
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-slate-400">[메모] 화면에서 이 단계를 연결하면 여기에 보여요.</p>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((n) => (
            <li key={n.id}>
              <Link href={`/notes?id=${n.id}`} className="flex items-center gap-1.5 rounded px-1.5 py-1 text-sm hover:bg-slate-50">
                <span className="text-xs">{n.icon || (n.kind === "mindmap" ? "🧠" : "📄")}</span>
                <span className={`min-w-0 flex-1 truncate ${n.title ? "" : "text-slate-400"}`}>{n.title || "제목 없음"}</span>
                {n.visibility === "private" && <span className="text-[10px]">🔒</span>}
                {n.stage_ids && !n.stage_ids.includes(stageId) && (
                  <span className="shrink-0 rounded bg-slate-100 px-1 text-[10px] text-slate-500" title="본문에서 [[이 단계]]를 가리킨 메모">
                    언급
                  </span>
                )}
                <span className="shrink-0 text-[11px] text-slate-400">
                  {CAT[n.category]} · {n.note_date.slice(5).replace("-", "/")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
