"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useApp } from "@/components/AppProvider";
import { Toast } from "@/components/ui";
import { relativeTime } from "@/lib/dates";
import { findMentions } from "@/lib/atlassian/extract";

interface State {
  key: string;
  value: Record<string, unknown>;
  updated_at: string;
}

function Copy({ text, onCopied, label = "복사" }: { text: string; onCopied: () => void; label?: string }) {
  return (
    <button
      className="btn-outline py-0.5 text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          onCopied();
        } catch {
          prompt("복사해서 쓰세요", text);
        }
      }}
    >
      {label}
    </button>
  );
}

function Code({ children }: { children: string }) {
  return <pre className="scroll-thin overflow-x-auto whitespace-pre rounded-lg bg-slate-900 p-3 text-[12px] leading-relaxed text-slate-100">{children}</pre>;
}

export default function AtlassianPage() {
  const { me } = useApp();
  const [ready, setReady] = useState<boolean | null>(null);
  const [states, setStates] = useState<State[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [test, setTest] = useState("");
  const [found, setFound] = useState<Record<string, { name: string; project: string; pid: string; id: string } | null>>({});
  const origin = typeof window !== "undefined" ? window.location.origin : "https://rbtngamepartnpd.netlify.app";

  const show = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2500);
  };

  const load = useCallback(async () => {
    const { data, error } = await supabase().from("integration_state").select("*");
    if (error) return setReady(false);
    setReady(true);
    setStates((data ?? []) as State[]);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const mentions = useMemo(() => (test.trim() ? findMentions("", test) : []), [test]);
  useEffect(() => {
    const codes = mentions.map((m) => m.code).filter((c) => !(c in found));
    if (!codes.length) return;
    supabase()
      .from("stages")
      .select("id,name,ref_code,project_id,projects(name)")
      .in("ref_code", codes)
      .then(({ data }) => {
        const next = { ...found };
        codes.forEach((c) => (next[c] = null));
        (data ?? []).forEach((s) => {
          const p = s.projects as unknown as { name: string } | null;
          next[s.ref_code as string] = { name: s.name, project: p?.name ?? "", pid: s.project_id, id: s.id };
        });
        setFound(next);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mentions]);

  async function pollNow() {
    setBusy(true);
    const r = await fetch("/api/atlassian/poll", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (j.skipped) show("API 토큰 환경변수가 없어 정기 수집은 꺼져 있습니다 (아래 2번 참고)");
    else if (!r.ok || j.error) show(`실패: ${j.error ?? r.status}`);
    else
      show(
        `수집 완료 · 컨플루언스 문서 ${j.confluence?.pages ?? 0}개${j.confluence?.error ? ` (오류: ${j.confluence.error})` : ""} · 지라 이슈 ${j.jira?.issues ?? 0}개${j.jira?.error ? ` (오류: ${j.jira.error})` : ""}`
      );
    load();
  }

  const st = (k: string) => states.find((s) => s.key === k)?.value as Record<string, string | number | null> | undefined;
  const hook = st("jira_webhook");
  const conf = st("confluence");
  const jira = st("jira");

  const body = `{
  "key": "{{issue.key}}",
  "url": "{{issue.url}}",
  "summary": "{{issue.summary.jsonEncode}}",
  "status": "{{issue.status.name}}",
  "assignee": "{{issue.assignee.displayName}}",
  "duedate": "{{issue.duedate.jiraDate}}",
  "description": "{{issue.description.jsonEncode}}",
  "comment": "{{comment.body.jsonEncode}}"
}`;
  const slackMsg = `:arrows_counterclockwise: *{{issue.key}} {{issue.summary}}*
상태: {{fieldChange.fromString}} → *{{fieldChange.toString}}* (담당 {{issue.assignee.displayName}})
NPD 단계 업데이트 부탁드립니다 👉 ${origin}/s/{{issue.description.match("(NPD-[2-9A-HJKMNP-Z]{5})")}}
지라: {{issue.url}}`;

  if (ready === false) {
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        <h1 className="text-xl font-semibold tracking-tight">지라·컨플루언스 연동</h1>
        <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
          DB 업데이트가 필요합니다. 관리자가 Supabase SQL Editor에서 <code className="rounded bg-white/60 px-1">supabase/008_stage_tools.sql</code>을 실행해 주세요.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">지라·컨플루언스 연동</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            단계마다 있는 <b className="font-mono">NPD-XXXXX</b> 코드(또는 단계 링크)를 지라 이슈·댓글이나 컨플루언스 문서에 적어두면, NPD가 찾아서 그 단계의 <b>기록</b>에 모읍니다.{" "}
            <b>결정:</b> / <b>이슈:</b>로 시작하는 줄은 결정·이슈 기록으로 따로 들어옵니다.
          </p>
        </div>
        <button className="btn-primary" disabled={busy} onClick={pollNow}>
          {busy ? "수집 중…" : "지금 수집"}
        </button>
      </div>

      {/* 상태 */}
      <div className="grid gap-3 md:grid-cols-3">
        {[
          {
            t: "지라 실시간 (자동화 규칙)",
            ok: !!hook?.last_at,
            line: hook?.last_at ? `마지막 수신 ${relativeTime(String(hook.last_at))} · ${hook.last_key}` : "아직 받은 적 없음 — 아래 1번 설정",
            err: null,
          },
          {
            t: "컨플루언스 (매시간)",
            ok: !!conf?.last_ok && !conf?.error,
            line: conf?.last_ok ? `마지막 수집 ${relativeTime(String(conf.last_ok))} · 문서 ${conf.pages ?? 0}개 확인` : "아직 수집 전 — 아래 2번 설정",
            err: conf?.error,
          },
          {
            t: "지라 보조 수집 (매시간)",
            ok: !!jira?.last_ok && !jira?.error,
            line: jira?.last_ok ? `마지막 수집 ${relativeTime(String(jira.last_ok))} · 이슈 ${jira.issues ?? 0}개 확인` : "아직 수집 전 — 2번 설정 시 함께 켜짐",
            err: jira?.error,
          },
        ].map((c) => (
          <div key={c.t} className="card p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className={`h-2 w-2 rounded-full ${c.err ? "bg-rose-500" : c.ok ? "bg-emerald-500" : "bg-slate-300"}`} />
              {c.t}
            </div>
            <p className="mt-1 text-xs text-slate-500">{c.line}</p>
            {c.err && <p className="mt-1 rounded bg-rose-50 px-2 py-1 text-xs text-rose-700">{String(c.err)}</p>}
          </div>
        ))}
      </div>

      {/* 코드 테스트 */}
      <section className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold">인식 테스트</h2>
        <p className="text-xs text-slate-500">지라·컨플루언스에 쓸 글을 붙여넣어 보세요. NPD가 무엇을 가져갈지 미리 보여줍니다.</p>
        <textarea
          className="input min-h-24 font-mono text-xs"
          placeholder={"예)\n회의록 — NPD-K7Q2M 패키지 검토\n결정: 패키지는 2안으로 진행\n이슈: 금형 일정이 1주 늦어질 수 있음"}
          value={test}
          onChange={(e) => setTest(e.target.value)}
        />
        {test.trim() && mentions.length === 0 && <p className="text-xs text-amber-700">NPD 코드를 찾지 못했습니다. 단계 상세 위쪽의 코드(NPD-로 시작, 5글자)를 그대로 붙여넣으세요.</p>}
        {mentions.map((m) => {
          const s = found[m.code];
          return (
            <div key={m.code} className="rounded-lg border border-black/10 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-xs text-white">{m.code}</span>
                {s === undefined ? (
                  <span className="text-xs text-slate-400">찾는 중…</span>
                ) : s ? (
                  <Link className="text-xs text-brand-600 hover:underline" href={`/projects/${s.pid}?stage=${s.id}`}>
                    {s.project} › {s.name}
                  </Link>
                ) : (
                  <span className="text-xs text-rose-600">이 코드의 단계가 없습니다</span>
                )}
              </div>
              <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
                <li>• 참조 기록 1건 (이슈·문서 링크 + 언급 줄)</li>
                {m.marked.map((x, i) => (
                  <li key={i}>
                    • <b className={x.kind === "decision" ? "text-violet-700" : "text-rose-700"}>{x.kind === "decision" ? "결정" : "이슈"}</b> 기록: {x.text}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      {/* 1. 지라 자동화 */}
      <section className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold">1. 지라 → NPD 실시간 (지라 자동화 규칙, 지라 관리자가 한 번)</h2>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
          <li>
            지라 <b>프로젝트 설정 → 자동화(Automation) → 규칙 만들기</b> (여러 프로젝트에 쓰려면 <b>설정 ⚙️ → 시스템 → 전역 자동화</b>)
          </li>
          <li>
            트리거: <b>여러 작업 항목 이벤트</b>(Multiple work item events)에서 <i>생성됨·업데이트됨·전환됨·댓글 추가됨</i>을 고릅니다. 이 트리거가 없으면 같은 규칙을 &lsquo;작업 항목 전환됨&rsquo;, &lsquo;댓글 추가됨&rsquo;으로 하나씩 만드세요.
          </li>
          <li>
            조건(선택): <b>고급 비교 조건</b> — 첫 번째 값 <code className="rounded bg-slate-100 px-1">{"{{issue.summary}} {{issue.description}} {{comment.body}}"}</code>, 조건 <i>정규식 포함</i>, 값{" "}
            <code className="rounded bg-slate-100 px-1">NPD-[2-9A-Z]{"{5}"}</code> → 코드가 적힌 이슈만 보냅니다.
          </li>
          <li>
            작업: <b>웹 요청 보내기</b>(Send web request)
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li className="flex flex-wrap items-center gap-2">
                URL: <code className="rounded bg-slate-100 px-1">{origin}/api/atlassian/jira</code> <Copy text={`${origin}/api/atlassian/jira`} onCopied={() => show("URL 복사")} />
              </li>
              <li>
                메서드 <b>POST</b> · 헤더 <code className="rounded bg-slate-100 px-1">Content-Type: application/json</code>, <code className="rounded bg-slate-100 px-1">X-NPD-Key: (비밀값)</code>
                <div className="text-xs text-slate-500">
                  비밀값은 Netlify 환경변수 <code>ATLASSIAN_WEBHOOK_SECRET</code>에 넣은 값입니다 (없으면 <code>CRON_SECRET</code> 값). {me?.is_admin ? "관리자만 알고 있으면 됩니다." : "관리자에게 받으세요."}
                </div>
              </li>
              <li>
                본문: <b>사용자 지정 데이터</b>(Custom data)에 아래를 붙여넣기 <Copy text={body} onCopied={() => show("본문 복사")} />
              </li>
            </ul>
          </li>
          <li>규칙을 켜고, 코드를 적은 테스트 이슈에 댓글을 달아 보세요. 위 &lsquo;지라 실시간&rsquo; 상태가 초록색으로 바뀌면 끝.</li>
        </ol>
        <Code>{body}</Code>
      </section>

      {/* 2. 정기 수집 */}
      <section className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold">2. 컨플루언스 (+지라 보조) 매시간 수집 — Netlify 환경변수 (관리자가 한 번)</h2>
        <p className="text-sm text-slate-600">컨플루언스 문서는 매시간 최근에 고친 문서를 읽어서 코드를 찾습니다. 지라 자동화 규칙이 없어도 지라 이슈를 같은 방식으로 찾아옵니다.</p>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-black/[0.05]">
            {[
              ["ATLASSIAN_SITE", "redbutton.atlassian.net 처럼 회사 주소 (https:// 빼고)"],
              ["ATLASSIAN_EMAIL", "API 토큰을 만든 계정 이메일 (읽기 권한이 있는 계정)"],
              ["ATLASSIAN_API_TOKEN", "id.atlassian.com → 보안 → API 토큰 만들기 (Contains secret values 체크)"],
              ["ATLASSIAN_CONFLUENCE_SPACES", "(선택) 읽을 스페이스 키, 쉼표로. 비우면 전체"],
              ["ATLASSIAN_WEBHOOK_SECRET", "(선택) 1번 X-NPD-Key 값. 비우면 CRON_SECRET 사용"],
            ].map(([k, v]) => (
              <tr key={k}>
                <td className="py-1.5 pr-3 font-mono text-xs">{k}</td>
                <td className="py-1.5 text-xs text-slate-600">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-slate-500">넣은 뒤 Netlify에서 다시 배포(Deploy project)하면 매시간 자동으로 돕니다. 위 [지금 수집]으로 바로 확인할 수 있어요.</p>
      </section>

      {/* 3. 슬랙 */}
      <section className="card space-y-3 p-5" id="slack">
        <h2 className="text-sm font-semibold">3. 지라 상태가 바뀌면 슬랙으로 &lsquo;NPD 업데이트 요청&rsquo; 보내기 (지라 자동화)</h2>
        <p className="text-sm text-slate-600">NPD 사이트가 아니라 지라 자동화 규칙으로 만듭니다. 트리거 조건을 지라에서 자유롭게 정할 수 있어요.</p>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
          <li>
            슬랙: 알림 받을 채널에서 <b>앱 추가 → Incoming Webhooks</b>(또는 Workflow Builder의 웹훅)로 <b>웹훅 URL</b>을 만듭니다. 이미 &lsquo;Jira Cloud&rsquo; 슬랙 앱이 있으면 생략.
          </li>
          <li>
            지라 자동화 → 규칙 만들기 → 트리거 <b>작업 항목 전환됨</b>(Work item transitioned)
            <div className="text-xs text-slate-500">여기서 &lsquo;시작 상태 → 대상 상태&rsquo;를 고르면 그 전환만 알림 (예: 진행 중 → 검토 요청, 아무 상태 → 완료)</div>
          </li>
          <li>
            조건 추가 (원하는 만큼):
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-slate-600">
              <li>
                <b>JQL 조건</b> — 예) <code className="rounded bg-slate-100 px-1">project = GAME AND labels = NPD</code>
              </li>
              <li>
                <b>고급 비교</b> — 설명에 NPD 코드가 있는 이슈만: <code className="rounded bg-slate-100 px-1">{"{{issue.description}}"}</code> 정규식 포함{" "}
                <code className="rounded bg-slate-100 px-1">NPD-[2-9A-Z]{"{5}"}</code>
              </li>
              <li>
                <b>작업 항목 필드 조건</b> — 우선순위·담당자·이슈 유형 등
              </li>
            </ul>
          </li>
          <li>
            작업: <b>Slack 메시지 보내기</b>(Send Slack message) — 1번의 웹훅 URL, 채널 입력. 메시지는 아래를 붙여넣고 고치세요 <Copy text={slackMsg} onCopied={() => show("메시지 복사")} />
          </li>
          <li>담당자에게 직접 보내려면 메시지에 <code className="rounded bg-slate-100 px-1">{"@{{issue.assignee.displayName}}"}</code> 대신 슬랙 DM 대상(사용자 ID)을 넣거나, &lsquo;이메일 보내기&rsquo; 작업을 함께 쓰세요.</li>
        </ol>
        <Code>{slackMsg}</Code>
        <p className="text-xs text-slate-500">
          메시지 속 링크는 이슈 설명의 첫 NPD 코드로 해당 단계를 바로 엽니다. 코드가 없는 이슈라면 그 줄은 지우세요.
        </p>
      </section>
      <Toast msg={toast} />
    </div>
  );
}
