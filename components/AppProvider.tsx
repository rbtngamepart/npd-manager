"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { DEFAULT_DEPARTMENTS } from "@/lib/departments";
import type { Department, Profile } from "@/lib/types";

interface Ctx {
  me: Profile | null;
  profiles: Profile[];
  profileById: Record<string, Profile>;
  reloadProfiles: () => Promise<void>;
  loading: boolean;
  /** 관리자가 정한 부서 목록 (순서대로). 아직 DB 업데이트 전이면 null */
  departments: Department[] | null;
  /** 화면에서 고를 수 있는 부서 이름 */
  deptNames: string[];
  reloadDepartments: () => Promise<void>;
}

export const AppCtx = createContext<Ctx>({
  me: null,
  profiles: [],
  profileById: {},
  reloadProfiles: async () => {},
  loading: true,
  departments: null,
  deptNames: DEFAULT_DEPARTMENTS,
  reloadDepartments: async () => {},
});

export function useApp() {
  return useContext(AppCtx);
}

export function displayName(p?: Profile | null) {
  if (!p) return "알 수 없음";
  return p.name || p.email.split("@")[0];
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [departments, setDepartments] = useState<Department[] | null>(null);
  const [loading, setLoading] = useState(true);

  const reloadDepartments = useCallback(async () => {
    const { data, error } = await supabase().from("departments").select("*").order("sort_order").order("name");
    setDepartments(error ? null : ((data ?? []) as Department[]));
  }, []);

  const reloadProfiles = useCallback(async () => {
    const sb = supabase();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) {
      setMe(null);
      setLoading(false);
      return;
    }
    const [{ data }] = await Promise.all([sb.from("profiles").select("*").order("created_at"), reloadDepartments()]);
    const list = (data ?? []) as Profile[];
    setProfiles(list);
    setMe(list.find((p) => p.id === user.id) ?? null);
    setLoading(false);
  }, [reloadDepartments]);

  useEffect(() => {
    reloadProfiles();
  }, [reloadProfiles]);

  const profileById = useMemo(() => Object.fromEntries(profiles.map((p) => [p.id, p])), [profiles]);

  const deptNames = useMemo(() => {
    if (departments && departments.length) return departments.map((d) => d.name);
    // DB 업데이트 전: 기본 부서 + 사용자 부서
    const set = new Set(DEFAULT_DEPARTMENTS);
    profiles.forEach((p) => p.department && set.add(p.department));
    return Array.from(set);
  }, [departments, profiles]);

  return (
    <AppCtx.Provider value={{ me, profiles, profileById, reloadProfiles, loading, departments, deptNames, reloadDepartments }}>
      {children}
    </AppCtx.Provider>
  );
}
