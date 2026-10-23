"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

interface Ctx {
  me: Profile | null;
  profiles: Profile[];
  profileById: Record<string, Profile>;
  reloadProfiles: () => Promise<void>;
  loading: boolean;
}

const AppCtx = createContext<Ctx>({
  me: null,
  profiles: [],
  profileById: {},
  reloadProfiles: async () => {},
  loading: true,
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
  const [loading, setLoading] = useState(true);

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
    const { data } = await sb.from("profiles").select("*").order("created_at");
    const list = (data ?? []) as Profile[];
    setProfiles(list);
    setMe(list.find((p) => p.id === user.id) ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    reloadProfiles();
  }, [reloadProfiles]);

  const profileById = useMemo(() => Object.fromEntries(profiles.map((p) => [p.id, p])), [profiles]);

  return (
    <AppCtx.Provider value={{ me, profiles, profileById, reloadProfiles, loading }}>{children}</AppCtx.Provider>
  );
}
