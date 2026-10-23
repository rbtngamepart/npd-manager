"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useApp } from "@/components/AppProvider";
import { Toast } from "@/components/ui";

export default function SettingsPage() {
  const { me, reloadProfiles } = useApp();
  const [name, setName] = useState(me?.name ?? "");
  const [dept, setDept] = useState(me?.department ?? "");
  const [toast, setToast] = useState<string | null>(null);

  if (!me) return null;

  async function save() {
    await supabase().from("profiles").update({ name: name.trim() || null, department: dept.trim() || null }).eq("id", me!.id);
    await reloadProfiles();
    setToast("저장했습니다");
    setTimeout(() => setToast(null), 1800);
  }

  return (
    <div className="mx-auto max-w-md space-y-5">
      <h1 className="text-xl font-semibold tracking-tight">내 정보</h1>
      <div className="card space-y-4 p-5">
        <div>
          <label className="label">이메일</label>
          <input className="input" disabled value={me.email} />
        </div>
        <div>
          <label className="label">이름 (기록에 표시)</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">부서</label>
          <input className="input" value={dept} onChange={(e) => setDept(e.target.value)} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">
            권한: {me.is_game_part ? "게임파트 (전체 편집)" : "프로젝트별 편집"}
            {me.is_admin ? " · 관리자" : ""}
          </span>
          <button className="btn-primary" onClick={save}>
            저장
          </button>
        </div>
      </div>
      <Toast msg={toast} />
    </div>
  );
}
