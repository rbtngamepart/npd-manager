"use client";

// 단계 참조 링크: /s/NPD-K7Q2M → 해당 프로젝트의 단계 상세
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";

export default function StageLink() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const c = decodeURIComponent(code).trim().toUpperCase();
    supabase()
      .from("stages")
      .select("id,project_id")
      .eq("ref_code", c)
      .maybeSingle()
      .then(({ data }) => {
        if (data) router.replace(`/projects/${data.project_id}?stage=${data.id}`);
        else setMissing(true);
      });
  }, [code, router]);

  return (
    <div className="py-20 text-center text-sm text-slate-500">
      {missing ? (
        <>
          <p>
            <b className="font-mono">{decodeURIComponent(code)}</b> 단계를 찾을 수 없습니다. 삭제됐거나 코드가 틀렸을 수 있어요.
          </p>
          <Link href="/" className="mt-3 inline-block underline">
            대시보드로
          </Link>
        </>
      ) : (
        "단계로 이동하는 중…"
      )}
    </div>
  );
}
