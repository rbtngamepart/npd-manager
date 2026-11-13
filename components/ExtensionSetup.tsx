"use client";

// 크롬 확장 프로그램 'NPD 캘린더 도우미' 설치·연결 안내
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { relativeTime } from "@/lib/dates";
import { Help } from "./Tip";

interface Tok {
  id: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
}

const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function ExtensionSetup({ toast }: { toast: (m: string) => void }) {
  const [tokens, setTokens] = useState<Tok[] | null>(null);
  const [ready, setReady] = useState(true);
  const [label, setLabel] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase().from("ext_tokens").select("id,label,created_at,last_used_at").order("created_at", { ascending: false });
    if (error) {
      setReady(false);
      setTokens([]);
      return;
    }
    setReady(true);
    setTokens((data ?? []) as Tok[]);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function issue() {
    const { data, error } = await supabase().rpc("ext_token_issue", { p_label: label.trim() || null });
    if (error) return toast(/ext_token_issue|ext_tokens/.test(error.message) ? "DB 업데이트(011_ext_tokens.sql)가 필요합니다" : `실패: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as { token: string };
    setCode(`NPD1.${b64url(window.location.origin)}.${row.token}`);
    setLabel("");
    load();
  }
  async function revoke(t: Tok) {
    if (!confirm(`'${t.label || "이름 없음"}' 연결을 끊을까요? 그 컴퓨터의 확장 프로그램은 더 이상 목록을 받지 못합니다.`)) return;
    await supabase().from("ext_tokens").delete().eq("id", t.id);
    load();
  }
  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast("연결 코드를 복사했습니다. 확장 프로그램 설정에 붙여넣으세요");
    } catch {
      prompt("복사해서 쓰세요", code);
    }
  }

  return (
    <section className="card p-5" data-tour="cal-extension">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">
            크롬 확장 프로그램 &lsquo;NPD 캘린더 도우미&rsquo;
            <Help
              title="무엇이 편해지나요"
              width={300}
              content={
                <>
                  구글 캘린더에서 일정 제목 칸을 누르면 옆에 <b>NPD 단계</b> 버튼이 생깁니다. 프로젝트·단계를 고르면 제목이{" "}
                  <b>[말머리] 단계명 - 세부</b>로 채워지고, 설명 칸에 단계 링크도 들어가요. 말머리를 외워서 칠 필요가 없습니다.
                </>
              }
            />
          </h2>
          <p className="mt-1 text-xs text-slate-500">말머리를 직접 입력하지 않고, 캘린더에서 NPD 단계를 골라 넣습니다. 컴퓨터마다 한 번 설치하세요.</p>
        </div>
        <a className="btn-primary shrink-0 py-1.5 text-xs" href="/npd-calendar-extension.zip" download>
          확장 프로그램 받기 (zip)
        </a>
      </div>

      <button className="mt-3 text-xs font-medium text-brand-600 hover:underline" onClick={() => setOpen((v) => !v)}>
        {open ? "설치 방법 접기 ▴" : "설치 방법 보기 ▾"}
      </button>
      {open && (
        <ol className="mt-2 list-decimal space-y-1.5 rounded-lg bg-slate-50 p-3 pl-7 text-sm text-slate-700">
          <li>위 버튼으로 zip을 받아 <b>압축을 풉니다</b> (폴더 위치는 지우지 않을 곳으로).</li>
          <li>
            크롬 주소창에 <code className="rounded bg-white px-1">chrome://extensions</code> 입력 → 오른쪽 위 <b>개발자 모드</b> 켜기
          </li>
          <li>
            <b>압축해제된 확장 프로그램을 로드합니다</b> → 압축 푼 <code className="rounded bg-white px-1">npd-calendar-extension</code> 폴더 선택
          </li>
          <li>자동으로 열리는 설정 창에 아래에서 만든 <b>연결 코드</b>를 붙여넣고 [저장하고 연결 확인]</li>
          <li>
            구글 캘린더를 새로고침 → 일정 제목 칸을 누르면 옆에 <b>NPD 단계</b> 버튼, 왼쪽 아래 <b>NPD</b> 버튼, 단축키 <b>Alt+N</b>. 이미 있는 일정은 눌렀을 때 뜨는 상세 창 위쪽의 빨간 <b>N</b> 버튼
          </li>
          <li className="text-xs text-slate-500">
            업데이트가 나오면 새 zip으로 폴더를 덮어쓰고 chrome://extensions에서 ↻(새로고침)을 누르세요. 회사 정책으로 개발자 모드가 막혀 있으면 관리자에게 알려주세요.
          </li>
        </ol>
      )}

      <div className="mt-4 border-t border-black/[0.06] pt-4">
        <h3 className="text-xs font-semibold text-slate-700">내 연결 코드</h3>
        {!ready ? (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">DB 업데이트가 필요합니다. 관리자가 supabase/011_ext_tokens.sql 을 실행해 주세요.</p>
        ) : (
          <>
            <div className="mt-2 flex gap-2">
              <input className="input" placeholder="이 코드를 쓸 컴퓨터 (예: 회사 PC)" value={label} onChange={(e) => setLabel(e.target.value)} />
              <button className="btn-outline shrink-0" onClick={issue}>
                연결 코드 만들기
              </button>
            </div>
            {code && (
              <div className="mt-2 space-y-1.5 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate text-[11px]">{code}</code>
                  <button className="btn-primary shrink-0 py-1 text-xs" onClick={copy}>
                    복사
                  </button>
                </div>
                <p className="text-[11px] text-emerald-800">지금만 보여요. 확장 프로그램 설정에 붙여넣으세요. 다른 사람과 공유하지 마세요.</p>
              </div>
            )}
            {tokens && tokens.length > 0 && (
              <ul className="mt-3 divide-y divide-black/[0.05] rounded-lg border border-black/[0.07] text-sm">
                {tokens.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate">{t.label || "이름 없음"}</span>
                    <span className="shrink-0 text-[11px] text-slate-400">{t.last_used_at ? `${relativeTime(t.last_used_at)} 사용` : "아직 사용 안 함"}</span>
                    <button className="btn-danger shrink-0 px-2 py-0.5 text-xs" onClick={() => revoke(t)}>
                      연결 끊기
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}
