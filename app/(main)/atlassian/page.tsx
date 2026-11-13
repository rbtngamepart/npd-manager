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
  const slack = st("slack");

  async function testSlack() {
    const r = await fetch("/api/atlassian/slack-test", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    show(j.ok ? "슬랙에 시험 메시지를 보냈습니다. 채널을 확인하세요" : `실패: ${j.error ?? r.status}`);
  }

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
  const slackMsg = `:arrows_counterclockwise: *NPD 업데이트 요청* · {{issue.key}} {{issue.summary}}
{{#if(comment)}}새 댓글: {{comment.body.abbreviate(150)}}{{/}}{{#if(fieldChange)}}변경: {{fieldChange.field}} {{fieldChange.fromString}} → *{{fieldChange.toString}}*{{/}} (담당 {{issue.assignee.displayName}})
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
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">3. 바뀌면 슬랙으로 &lsquo;NPD 업데이트 요청&rsquo; 보내기</h2>
          <span className={`rounded-full px-2 py-0.5 text-[11px] ${slack?.last_at ? (slack.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700") : "bg-slate-100 text-slate-500"}`}>
            {slack?.last_at ? `마지막 알림 ${relativeTime(String(slack.last_at))}${slack.ok ? "" : ` · 실패: ${slack.error}`}` : "아직 보낸 적 없음"}
          </span>
          <button className="btn-outline ml-auto py-1 text-xs" onClick={testSlack}>
            시험 메시지 보내기
          </button>
        </div>
        <p className="text-sm text-slate-600">
          NPD 코드가 적힌 지라 이슈·컨플루언스 문서가 바뀌면 <b>NPD가 직접</b> 슬랙 채널로 알려줍니다. 1번(지라 실시간)·2번(정기 수집)으로 들어온 내용을 비교해서 보냅니다.
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="py-1 pr-3 font-medium">언제</th>
              <th className="py-1 font-medium">알림 내용</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.05] text-xs text-slate-700">
            <tr>
              <td className="py-1.5 pr-3">지라 상태 변경</td>
              <td>상태 진행 → <b>완료</b></td>
            </tr>
            <tr>
              <td className="py-1.5 pr-3">지라 새 댓글</td>
              <td>새 댓글 + 댓글 앞부분</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-3">지라 제목·설명 수정</td>
              <td>제목·설명 수정 (서식만 바뀐 경우는 제외)</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-3">컨플루언스 문서 생성·수정</td>
              <td>새로 코드가 적힌 문서 / 문서 내용 수정</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-3">처음 코드를 적었을 때</td>
              <td>NPD 코드가 새로 연결됨</td>
            </tr>
          </tbody>
        </table>
        <p className="text-xs text-slate-500">메시지에는 지라·문서 링크, 연결된 NPD 단계 링크(프로젝트 › 단계), 프로젝트 PM 이름이 들어갑니다. 코드가 없는 이슈·문서는 알리지 않아요.</p>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
          <li>
            슬랙: 알림 받을 채널 → <b>앱 추가 → Incoming Webhooks</b>(슬랙 관리자 승인이 필요할 수 있음) → <b>웹훅 URL</b> 복사 (<code>https://hooks.slack.com/services/…</code>)
          </li>
          <li>
            Netlify 환경변수 <code className="rounded bg-slate-100 px-1">SLACK_WEBHOOK_URL</code>에 붙여넣기 (Contains secret values 체크) → 다시 배포
          </li>
          <li>
            Supabase SQL Editor에서 <code className="rounded bg-slate-100 px-1">010_ext_hash.sql</code> 실행 (바뀐 내용 비교용)
          </li>
          <li>
            1번 지라 규칙의 트리거에 <b>&lsquo;업무 항목에 댓글이 달림&rsquo;</b>(댓글 추가됨)도 넣어야 댓글이 바로 들어옵니다. 없어도 2번 정기 수집이 매시간 찾아와요.
          </li>
          <li>[시험 메시지 보내기]로 채널에 오는지 확인</li>
        </ol>
        <p className="text-xs text-slate-500">
          컨플루언스는 매시간 수집이라 최대 1시간 늦게, 지라는 1번 규칙이 있으면 바로 알립니다. 010 실행 직후 처음 수집할 때는 비교 기준만 저장하고 알리지 않습니다.
        </p>

        <details className="rounded-lg bg-slate-50 p-3 text-sm">
          <summary className="cursor-pointer font-medium text-slate-700">따로: 지라 자동화로 조건을 세밀하게 정해 슬랙 보내기</summary>
          <p className="mt-2 text-xs text-slate-600">특정 프로젝트·상태 전환만, 담당자에게만 등 조건을 지라에서 직접 정하고 싶을 때 씁니다. 위 NPD 알림과 함께 쓰면 메시지가 두 번 갈 수 있어요.</p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
            <li>
              트리거 <b>여러 업무 항목 이벤트</b> — <i>업무 항목 전환됨 · 업무 항목에 댓글이 달림 · 업무 항목이 업데이트됨</i> (전환만 원하면 &lsquo;업무 항목 전환됨&rsquo;에서 시작·대상 상태 지정)
            </li>
            <li>
              조건: <b>{"{{smart values}}"} 조건</b> — 첫 번째 값 <code className="rounded bg-white px-1">{"{{issue.summary}} {{issue.description}} {{comment.body}}"}</code>, 정규식 포함{" "}
              <code className="rounded bg-white px-1">NPD-[2-9A-Z]{"{5}"}</code> (+ JQL 조건 등 원하는 만큼)
            </li>
            <li>
              작업: <b>Slack 메시지 보내기</b> — 웹훅 URL과 아래 메시지 <Copy text={slackMsg} onCopied={() => show("메시지 복사")} />
            </li>
          </ol>
          <div className="mt-2">
            <Code>{slackMsg}</Code>
          </div>
        </details>
      </section>
      <Toast msg={toast} />
    </div>
  );
}
