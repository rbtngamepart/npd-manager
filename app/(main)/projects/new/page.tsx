"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useApp } from "@/components/AppProvider";
import { instantiate } from "@/lib/templates";
import { short, today } from "@/lib/dates";
import type { Template } from "@/lib/types";

export default function NewProject() {
  const { me } = useApp();
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("오리지널게임");
  const [description, setDescription] = useState("");
  const [start, setStart] = useState(today());
  const [tplId, setTplId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase()
      .from("templates")
      .select("*")
      .order("created_at")
      .then(({ data }) => {
        const list = (data ?? []) as Template[];
        setTemplates(list);
        if (list[0]) setTplId(list[0].id);
      });
  }, []);

  const tpl = templates.find((t) => t.id === tplId);
  const preview = useMemo(() => (tpl ? instantiate(tpl.stages, "", start || null) : []), [tpl, start]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const sb = supabase();
    const { data, error } = await sb
      .from("projects")
      .insert({
        name: name.trim(),
        category: category.trim() || null,
        description: description.trim() || null,
        start_date: start || null,
        pm_id: me?.id,
      })
      .select()
      .single();
    if (error || !data) {
      setErr(error?.message ?? "생성 실패");
      setBusy(false);
      return;
    }
    if (tpl) {
      const rows = instantiate(tpl.stages, data.id, start || null);
      if (rows.length) {
        const { error: e2 } = await sb.from("stages").insert(rows);
        if (e2) setErr(e2.message);
      }
    }
    router.replace(`/projects/${data.id}`);
  }

  if (me && !me.is_game_part) {
    return <p className="text-sm text-slate-500">프로젝트 생성은 게임파트만 할 수 있습니다.</p>;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-5 text-xl font-semibold tracking-tight">새 프로젝트</h1>
      <form onSubmit={create} className="grid gap-6 md:grid-cols-[1fr_1fr]">
        <div className="card space-y-4 p-5">
          <div data-tour="np-name">
            <label className="label">프로젝트명 *</label>
            <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="예) 2026 하반기 오리지널게임" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">유형</label>
              <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} list="cats" />
              <datalist id="cats">
                <option value="오리지널게임" />
                <option value="콜라보레이션" />
                <option value="튜토리얼·가이드" />
                <option value="게임 큐레이션" />
                <option value="고객 행사" />
              </datalist>
            </div>
            <div data-tour="np-start">
              <label className="label">프로젝트 시작일 (1주차)</label>
              <input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">설명</label>
            <textarea className="input min-h-20" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div data-tour="np-template">
            <label className="label">단계 템플릿</label>
            <select className="input" value={tplId} onChange={(e) => setTplId(e.target.value)}>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.stages.length}단계)
                </option>
              ))}
              <option value="">빈 프로젝트 (단계 직접 추가)</option>
            </select>
            <p className="mt-1 text-xs text-slate-400">만든 뒤에 단계 추가·삭제·일정 수정이 자유롭게 됩니다.</p>
          </div>
          {err && <p className="text-sm text-rose-600">{err}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => router.back()}>
              취소
            </button>
            <button className="btn-primary" disabled={busy || !name.trim()} data-tour="np-submit">
              {busy ? "만드는 중…" : "프로젝트 만들기"}
            </button>
          </div>
        </div>

        <div className="card self-start overflow-hidden" data-tour="np-preview">
          <div className="border-b border-black/[0.06] px-4 py-2.5 text-xs font-medium text-slate-500">단계 미리보기</div>
          {preview.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-400">단계 없이 시작합니다.</p>
          ) : (
            <ol className="divide-y divide-black/[0.05]">
              {preview.map((s, i) => (
                <li key={i} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <span className="w-5 text-right text-xs tabular-nums text-slate-400">{i + 1}</span>
                  <span className="flex-1 truncate">{s.name}</span>
                  <span className="text-xs tabular-nums text-slate-500">
                    {s.plan_start ? `${short(s.plan_start)} ~ ${short(s.plan_end)}` : "일정 미정"}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </form>
    </div>
  );
}
