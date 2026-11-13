"use client";

// 지라·컨플루언스에서 최근 수집된 내역: 어떤 단계가 언제 무엇으로 업데이트됐는지
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { relativeTime } from "@/lib/dates";

interface Item {
  id: string;
  project_id: string;
  stage_id: string | null;
  stage_name: string | null;
  kind: "memo" | "issue" | "decision" | "change";
  body: string;
  source: "jira" | "confluence";
  ext_key: string | null;
  ext_url: string | null;
  ext_title: string | null;
  ext_status: string | null;
  created_at: string;
  edited_at: string | null;
  stages: { name: string; ref_code: string | null } | null;
  projects: { name: string } | null;
}

const KIND_LABEL: Record<string, { t: string; c: string }> = {
  memo: { t: "언급", c: "bg-slate-100 text-slate-600" },
  decision: { t: "결정", c: "bg-violet-50 text-violet-700" },
  issue: { t: "이슈", c: "bg-rose-50 text-rose-700" },
};

const when = (i: Item) => i.edited_at ?? i.created_at;

export function ExternalHistory() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [limit, setLimit] = useState(30);
  const [src, setSrc] = useState<"all" | "jira" | "confluence">("all");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = supabase();
    const cols = "id,project_id,stage_id,stage_name,kind,body,source,ext_key,ext_url,ext_title,ext_status,created_at,edited_at,stages(name,ref_code),projects(name)";
    const base = () => {
      let q = sb.from("stage_logs").select(cols).not("source", "is", null);
      if (src !== "all") q = q.eq("source", src);
      return q;
    };
    // 새로 들어온 것과 나중에 바뀐 것을 합쳐 최근 순으로
    const [a, b] = await Promise.all([
      base().order("created_at", { ascending: false }).limit(limit),
      base().not("edited_at", "is", null).order("edited_at", { ascending: false }).limit(limit),
    ]);
    if (a.error || b.error) return setErr((a.error ?? b.error)!.message);
    const map = new Map<string, Item>();
    [...((a.data ?? []) as unknown as Item[]), ...((b.data ?? []) as unknown as Item[])].forEach((x) => map.set(x.id, x));
    setItems(Array.from(map.values()).sort((x, y) => when(y).localeCompare(when(x))).slice(0, limit));
  }, [limit, src]);

  useEffect(() => {
    load();
  }, [load]);

  // 수집되면 바로 갱신
  useEffect(() => {
    const ch = supabase()
      .channel("ext-history")
      .on("postgres_changes", { event: "*", schema: "public", table: "stage_logs" }, () => load())
      .subscribe();
    return () => {
      supabase().removeChannel(ch);
    };
  }, [load]);

  // 같은 날짜끼리 묶기
  const days: { day: string; list: Item[] }[] = [];
  (items ?? []).forEach((i) => {
    const d = new Date(when(i)).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short" });
    const last = days[days.length - 1];
    if (last?.day === d) last.list.push(i);
    else days.push({ day: d, list: [i] });
  });

  return (
    <section className="card p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">최근 수집 이력</h2>
        <span className="text-xs text-slate-400">어떤 단계에 무엇이 들어왔는지</span>
        <div className="ml-auto inline-flex rounded-lg bg-black/[0.04] p-0.5 text-xs">
          {(
            [
              ["all", "전체"],
              ["jira", "Jira"],
              ["confluence", "Confluence"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} onClick={() => setSrc(k)} className={`rounded-md px-2.5 py-1 ${src === k ? "bg-white font-medium shadow-sm" : "text-slate-500"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {err && <p className="rounded bg-rose-50 px-3 py-2 text-xs text-rose-700">불러오지 못했습니다: {err}</p>}
      {items === null && !err && <p className="py-6 text-center text-xs text-slate-400">불러오는 중…</p>}
      {items?.length === 0 && <p className="py-6 text-center text-xs text-slate-400">아직 수집된 내역이 없습니다. 지라·컨플루언스에 NPD 코드를 적으면 여기에 쌓여요.</p>}

      <div className="space-y-4">
        {days.map((d) => (
          <div key={d.day}>
            <div className="mb-1.5 text-[11px] font-semibold text-slate-400">{d.day}</div>
            <ul className="divide-y divide-black/[0.05] rounded-lg border border-black/[0.07]">
              {d.list.map((i) => {
                const k = KIND_LABEL[i.kind] ?? KIND_LABEL.memo;
                const updated = !!i.edited_at;
                const stageName = i.stages?.name ?? i.stage_name ?? "(삭제된 단계)";
                const text = i.kind === "memo" ? null : i.body.split("\n")[0];
                return (
                  <li key={i.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2 text-sm">
                    <span className="w-12 shrink-0 pt-0.5 text-[11px] tabular-nums text-slate-400" title={new Date(when(i)).toLocaleString("ko-KR")}>
                      {new Date(when(i)).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false })}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded bg-slate-900 px-1.5 py-px text-[10px] text-white">{i.source === "jira" ? "Jira" : "Confluence"}</span>
                        <span className={`rounded px-1.5 py-px text-[10px] ${k.c}`}>{k.t}</span>
                        <span className={`rounded px-1.5 py-px text-[10px] ${updated ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                          {updated ? "업데이트" : "새로 수집"}
                        </span>
                        {i.ext_url ? (
                          <a href={i.ext_url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate font-medium hover:underline">
                            {i.ext_title ?? i.ext_key}
                          </a>
                        ) : (
                          <span className="font-medium">{i.ext_title}</span>
                        )}
                        {i.ext_status && <span className="text-[11px] text-slate-500">· {i.ext_status}</span>}
                      </div>
                      {text && <p className="mt-0.5 truncate text-xs text-slate-600">{text}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5 text-xs">
                      <span className="text-slate-300">→</span>
                      {i.stage_id ? (
                        <Link href={`/projects/${i.project_id}?stage=${i.stage_id}`} className="max-w-[260px] truncate text-brand-600 hover:underline">
                          {i.projects?.name} › {stageName}
                        </Link>
                      ) : (
                        <span className="text-slate-400">{stageName}</span>
                      )}
                      {i.stages?.ref_code && <code className="rounded bg-slate-100 px-1 text-[10px] text-slate-500">{i.stages.ref_code}</code>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {items && items.length >= limit && (
        <div className="mt-3 text-center">
          <button className="btn-ghost text-xs" onClick={() => setLimit((l) => l + 30)}>
            더 보기
          </button>
        </div>
      )}
    </section>
  );
}
