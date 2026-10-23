"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { parseLooseDate, short, weeksToDates } from "@/lib/dates";
import { emojiToLight } from "@/lib/status";
import { splitDepartments } from "@/lib/departments";
import type { Light, Stage } from "@/lib/types";
import { Modal } from "./ui";

type Key =
  | "name"
  | "department"
  | "related"
  | "description"
  | "start_week"
  | "weeks"
  | "plan_start"
  | "plan_end"
  | "actual_start"
  | "expected_end"
  | "actual_end"
  | "progress"
  | "memo"
  | "pm"
  | "issue"
  | "next_action"
  | "assignee"
  | "needs_check";

// 시트 머리글 → 필드 (공백 무시, 앞부분 일치)
const HEADERS: [Key, string[]][] = [
  ["start_week", ["계획시작주차"]],
  ["weeks", ["계획기간"]],
  ["plan_start", ["계획시작일"]],
  ["plan_end", ["계획종료일"]],
  ["actual_start", ["실제시작일"]],
  ["expected_end", ["예상완료일", "현재예상완료일"]],
  ["actual_end", ["실제완료일"]],
  ["progress", ["진행률"]],
  ["memo", ["진행메모"]],
  ["pm", ["PM판단"]],
  ["issue", ["이슈"]],
  ["next_action", ["다음액션"]],
  ["assignee", ["담당/협의", "담당협의"]],
  ["needs_check", ["확인필요"]],
  ["related", ["연관부서", "협업부서", "관련부서", "협의부서"]],
  ["department", ["담당부서"]],
  ["description", ["주요내용"]],
];

// 머리글 없이 붙여넣었을 때: 'NPD 상세 양식' A~L 열 순서
const DEFAULT_ORDER: Key[] = [
  "name",
  "department",
  "description",
  "start_week",
  "weeks",
  "plan_start",
  "plan_end",
  "actual_start",
  "expected_end",
  "actual_end",
  "progress",
  "memo",
];

interface Row {
  include: boolean;
  name: string;
  department: string | null;
  related: string[] | null;
  description: string | null;
  plan_start: string | null;
  plan_end: string | null;
  actual_start: string | null;
  expected_end: string | null;
  actual_end: string | null;
  progress: number | null;
  pm_status: Light | null;
  issue: string | null;
  next_action: string | null;
  assignee: string | null;
  needs_check: boolean | null;
  memo: string | null;
}

const norm = (s: string) => s.replace(/\s+/g, "").replace(/\(.*?\)/g, "");

function splitTSV(text: string): string[][] {
  // 셀 안 줄바꿈("...")을 지원하는 간단한 TSV 파서
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && cell === "") q = true;
    else if (c === "\t") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function parse(text: string, projectStart: string | null): { rows: Row[]; mapped: Key[] } {
  const grid = splitTSV(text).filter((r) => r.some((c) => c.trim()));
  if (!grid.length) return { rows: [], mapped: [] };

  let headerIdx = grid.findIndex((r) => r.some((c) => ["단계", "진행단계"].includes(c.trim())));
  let cols: (Key | null)[];
  if (headerIdx >= 0) {
    cols = grid[headerIdx].map((h) => {
      const n = norm(h);
      if (n === "단계" || n === "진행단계") return "name";
      const hit = HEADERS.find(([, keys]) => keys.some((k) => n.startsWith(k)));
      return hit ? hit[0] : null;
    });
  } else {
    headerIdx = -1;
    cols = DEFAULT_ORDER;
  }
  const mapped = cols.filter(Boolean) as Key[];

  const rows: Row[] = [];
  for (const r of grid.slice(headerIdx + 1)) {
    const get = (k: Key) => {
      const i = cols.indexOf(k);
      const v = i >= 0 ? (r[i] ?? "").trim() : "";
      return v === "" ? null : v;
    };
    const name = get("name");
    if (!name || name === "단계" || name === "진행단계") continue;

    let plan_start = parseLooseDate(get("plan_start"));
    let plan_end = parseLooseDate(get("plan_end"));
    const sw = Number(get("start_week"));
    const wk = Number(get("weeks"));
    if ((!plan_start || !plan_end) && projectStart && sw > 0 && wk > 0) {
      const d = weeksToDates(projectStart, sw, wk);
      plan_start = d.start;
      plan_end = d.end;
    }
    const pRaw = get("progress");
    let progress: number | null = null;
    if (pRaw) {
      const n = parseFloat(pRaw.replace("%", ""));
      if (!isNaN(n)) progress = Math.round(n <= 1 && !pRaw.includes("%") && pRaw.includes(".") ? n * 100 : n);
    }
    const chk = get("needs_check");
    rows.push({
      include: !/개괄/.test(name),
      name,
      department: get("department"),
      related: get("related") === null ? null : splitDepartments(get("related")),
      description: get("description"),
      plan_start,
      plan_end,
      actual_start: parseLooseDate(get("actual_start")),
      expected_end: parseLooseDate(get("expected_end")),
      actual_end: parseLooseDate(get("actual_end")),
      progress: progress === null ? null : Math.min(100, Math.max(0, progress)),
      pm_status: emojiToLight(get("pm")),
      issue: get("issue"),
      next_action: get("next_action"),
      assignee: get("assignee"),
      needs_check: chk === null ? null : /^(true|y|yes|o|v|✓|✔|1|☑)$/i.test(chk),
      memo: get("memo"),
    });
  }
  return { rows, mapped };
}

const LABEL: Record<Key, string> = {
  name: "단계",
  department: "담당부서",
  related: "연관부서",
  description: "주요내용",
  start_week: "시작주차",
  weeks: "기간(주)",
  plan_start: "계획 시작일",
  plan_end: "계획 종료일",
  actual_start: "실제 시작일",
  expected_end: "예상 완료일",
  actual_end: "실제 완료일",
  progress: "진행률",
  memo: "진행 메모",
  pm: "PM 판단",
  issue: "이슈",
  next_action: "다음 액션",
  assignee: "담당/협의",
  needs_check: "확인 필요",
};

export function ImportDialog({
  open,
  onClose,
  projectId,
  projectStart,
  existing,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectStart: string | null;
  existing: Stage[];
  onDone: (msg: string) => void;
}) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"merge" | "append" | "replace">(existing.length ? "merge" : "append");
  const [overrides, setOverrides] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const parsed = useMemo(() => parse(text, projectStart), [text, projectStart]);
  const rows = parsed.rows.map((r, i) => ({ ...r, include: overrides[i] ?? r.include }));
  const picked = rows.filter((r) => r.include);

  async function run() {
    setBusy(true);
    setErr(null);
    const sb = supabase();
    try {
      if (mode === "replace" && existing.length) {
        const { error } = await sb.from("stages").delete().eq("project_id", projectId);
        if (error) throw error;
      }
      const pool = mode === "replace" ? [] : [...existing];
      let order = pool.reduce((m, s) => Math.max(m, s.sort_order), -1) + 1;
      let updated = 0;
      let inserted = 0;
      for (const r of picked) {
        // 붙여넣은 칸만 덮어쓰기 (빈 칸은 기존 값 유지)
        const patch: Partial<Stage> = {};
        const put = <K extends keyof Stage>(k: K, v: Stage[K] | null) => {
          if (v !== null && v !== undefined) patch[k] = v as Stage[K];
        };
        put("department", r.department);
        put("related_departments", r.related);
        put("description", r.description);
        put("plan_start", r.plan_start);
        put("plan_end", r.plan_end);
        put("actual_start", r.actual_start);
        put("expected_end", r.expected_end);
        put("actual_end", r.actual_end);
        put("progress", r.progress);
        put("pm_status", r.pm_status);
        put("issue", r.issue);
        put("next_action", r.next_action);
        put("assignee", r.assignee);
        put("needs_check", r.needs_check);

        const match = mode === "merge" ? pool.find((s) => norm(s.name) === norm(r.name)) : undefined;
        let stageId: string;
        if (match) {
          if (Object.keys(patch).length) {
            const { error } = await sb.from("stages").update(patch).eq("id", match.id);
            if (error) throw error;
          }
          stageId = match.id;
          updated++;
        } else {
          const { data, error } = await sb
            .from("stages")
            .insert({ ...patch, project_id: projectId, name: r.name, sort_order: order++ })
            .select("id")
            .single();
          if (error) throw error;
          stageId = data.id;
          inserted++;
        }
        if (r.memo) {
          await sb.from("stage_logs").insert({
            project_id: projectId,
            stage_id: stageId,
            stage_name: r.name,
            kind: "memo",
            body: `[시트에서 가져옴]\n${r.memo}`,
          });
        }
      }
      setText("");
      setOverrides({});
      onDone(`가져오기 완료 · 추가 ${inserted} · 업데이트 ${updated}`);
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="구글 시트에서 가져오기" width="max-w-4xl">
      <div className="space-y-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
          <li>
            시트의 <b>NPD 상세 양식</b> 또는 <b>PM 프로젝트 진행관리</b> 탭에서 <b>머리글 행부터</b> 필요한 행까지 선택해 복사(Ctrl+C)
          </li>
          <li>아래 칸에 붙여넣기(Ctrl+V) → 미리보기 확인 → 가져오기</li>
        </ol>
        <textarea
          data-tour="imp-text"
          className="input h-32 font-mono text-xs"
          placeholder={"단계\t담당부서\t주요내용(단계 설명)\t계획 시작주차\t계획 기간(주)\t…\n공모전 기획(공모전형)\t게임파트\t…\t1\t2"}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOverrides({});
          }}
        />
        {!projectStart && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            프로젝트 시작일이 없어 &lsquo;시작주차·기간&rsquo;으로는 날짜를 계산할 수 없습니다. 설정 탭에서 시작일을 먼저 입력하세요.
          </p>
        )}

        {rows.length > 0 && (
          <>
            <div className="flex flex-wrap gap-1 text-[11px]">
              <span className="text-slate-500">인식한 열:</span>
              {parsed.mapped.map((k) => (
                <span key={k} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                  {LABEL[k]}
                </span>
              ))}
            </div>
            <div className="scroll-thin max-h-72 overflow-auto rounded-lg border border-black/[0.07]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50">
                  <tr>
                    <th className="th w-8"></th>
                    <th className="th">단계</th>
                    <th className="th">담당부서</th>
                    <th className="th">계획</th>
                    <th className="th">실제</th>
                    <th className="th">진행률</th>
                    <th className="th">PM·메모</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.05]">
                  {rows.map((r, i) => (
                    <tr key={i} className={r.include ? "" : "opacity-40"}>
                      <td className="px-3 py-1.5">
                        <input
                          type="checkbox"
                          checked={r.include}
                          onChange={(e) => setOverrides((o) => ({ ...o, [i]: e.target.checked }))}
                        />
                      </td>
                      <td className="px-3 py-1.5 font-medium">{r.name}</td>
                      <td className="px-3 py-1.5">
                        {r.department ?? ""}
                        {r.related?.length ? <span className="text-violet-600"> +{r.related.join(", ")}</span> : null}
                      </td>
                      <td className="px-3 py-1.5 tabular-nums">{r.plan_start ? `${short(r.plan_start)}~${short(r.plan_end)}` : "—"}</td>
                      <td className="px-3 py-1.5 tabular-nums">
                        {r.actual_start ? short(r.actual_start) : ""}
                        {r.actual_end ? ` ~ ${short(r.actual_end)}` : r.expected_end ? ` (예상 ${short(r.expected_end)})` : ""}
                      </td>
                      <td className="px-3 py-1.5 tabular-nums">{r.progress ?? ""}</td>
                      <td className="max-w-[200px] truncate px-3 py-1.5 text-slate-500">
                        {[r.pm_status, r.issue, r.memo].filter(Boolean).join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center gap-4 text-sm" data-tour="imp-mode">
          <span className="text-xs text-slate-500">가져오는 방식</span>
          {existing.length > 0 && (
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={mode === "merge"} onChange={() => setMode("merge")} />
              같은 이름 단계는 업데이트, 나머지 추가
            </label>
          )}
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={mode === "append"} onChange={() => setMode("append")} />
            모두 새 단계로 추가
          </label>
          {existing.length > 0 && (
            <label className="flex items-center gap-1.5 text-rose-600">
              <input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} />
              기존 단계 모두 지우고 교체
            </label>
          )}
        </div>

        {err && <p className="text-sm text-rose-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            취소
          </button>
          <button
            data-tour="imp-run"
            className="btn-primary"
            disabled={busy || picked.length === 0}
            onClick={() => {
              if (mode === "replace" && !confirm(`기존 단계 ${existing.length}개를 모두 지우고 교체할까요?`)) return;
              run();
            }}
          >
            {busy ? "가져오는 중…" : `${picked.length}개 단계 가져오기`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
