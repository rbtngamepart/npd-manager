"use client";

// 메모·기록에 붙인 이미지·파일: Supabase Storage 'npd-files' (비공개) + 서명된 주소
import { supabase } from "@/lib/supabase/client";

export const FILE_BUCKET = "npd-files";
export const MAX_FILE_MB = 20;

export interface Uploaded {
  path: string;
  name: string;
  size: number;
  mime: string;
}

export async function uploadFile(file: File): Promise<Uploaded> {
  if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`${MAX_FILE_MB}MB보다 큰 파일은 올릴 수 없습니다: ${file.name}`);
  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
  const d = new Date();
  const path = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase().storage.from(FILE_BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) {
    if (/bucket|not found/i.test(error.message)) throw new Error("파일 저장 공간이 아직 없습니다. 관리자가 DB 업데이트 016을 실행해야 합니다.");
    throw new Error(error.message);
  }
  return { path, name: file.name, size: file.size, mime: file.type };
}

const cache = new Map<string, { url: string; exp: number }>();
const pending = new Map<string, Promise<string | null>>();

/** 저장 경로 → 1시간짜리 주소 (화면에서 쓰는 동안 재사용) */
export function signedUrl(path: string): Promise<string | null> {
  const hit = cache.get(path);
  if (hit && hit.exp > Date.now() + 60_000) return Promise.resolve(hit.url);
  const p0 = pending.get(path);
  if (p0) return p0;
  const p = (async () => {
    const { data } = await supabase().storage.from(FILE_BUCKET).createSignedUrl(path, 3600);
    pending.delete(path);
    if (!data?.signedUrl) return null;
    cache.set(path, { url: data.signedUrl, exp: Date.now() + 3600_000 });
    return data.signedUrl;
  })();
  pending.set(path, p);
  return p;
}

export async function openFile(path: string) {
  const w = window.open("", "_blank");
  const url = await signedUrl(path);
  if (url && w) w.location.href = url;
  else {
    w?.close();
    alert("파일을 열 수 없습니다. 권한이나 연결을 확인하세요.");
  }
}

export function fmtSize(n: number) {
  if (!n) return "";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

// ---- 임베드 ----------------------------------------------------------------
export type EmbedProvider = "youtube" | "drive" | "bookmark";

/** 주소 → 임베드 정보. iframe은 허용한 곳(유튜브·구글)만 */
export function embedFor(raw: string): { provider: EmbedProvider; src: string; iframe: string | null } | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.replace(/^www\./, "");
  // 유튜브
  let yt: string | null = null;
  if (host === "youtu.be") yt = u.pathname.slice(1);
  else if (host === "youtube.com" || host === "m.youtube.com") yt = u.searchParams.get("v") ?? (/^\/(shorts|embed|live)\/([\w-]{6,})/.exec(u.pathname)?.[2] || null);
  if (yt && /^[\w-]{6,20}$/.test(yt)) return { provider: "youtube", src: u.href, iframe: `https://www.youtube-nocookie.com/embed/${yt}` };
  // 구글 드라이브·문서·시트·슬라이드
  if (host === "drive.google.com" || host === "docs.google.com") {
    const id = /\/d\/([\w-]{10,})/.exec(u.pathname)?.[1] ?? u.searchParams.get("id");
    if (id && /^[\w-]+$/.test(id)) {
      const kind = /^\/(document|spreadsheets|presentation|forms)\//.exec(u.pathname)?.[1];
      const iframe = kind
        ? `https://docs.google.com/${kind}/d/${id}/${kind === "presentation" ? "embed" : kind === "forms" ? "viewform?embedded=true" : "preview"}`
        : `https://drive.google.com/file/d/${id}/preview`;
      return { provider: "drive", src: u.href, iframe };
    }
  }
  return { provider: "bookmark", src: u.href, iframe: null };
}

/** 이미 정리된 HTML 안의 이미지·파일·임베드를 실제로 보이게 (보기 화면용) */
export function hydrateRich(root: HTMLElement) {
  root.querySelectorAll<HTMLImageElement>("img[data-path]").forEach((img) => {
    const path = img.getAttribute("data-path");
    if (!path || img.dataset.ready === path) return;
    img.dataset.ready = path;
    img.removeAttribute("src");
    signedUrl(path).then((url) => url && (img.src = url));
  });
  root.querySelectorAll<HTMLElement>('div[data-type="embed"]').forEach((el) => {
    const src = el.getAttribute("data-src") ?? "";
    if (el.dataset.ready === src) return;
    el.dataset.ready = src;
    const info = embedFor(src);
    el.textContent = "";
    if (info?.iframe) {
      const f = document.createElement("iframe");
      f.src = info.iframe;
      f.setAttribute("allowfullscreen", "true");
      f.setAttribute("loading", "lazy");
      f.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      f.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-presentation");
      el.appendChild(f);
    } else if (info) {
      el.appendChild(bookmarkCard(info.src));
    }
  });
}

export function bookmarkCard(src: string): HTMLElement {
  const a = document.createElement("a");
  a.href = src;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.className = "npd-bookmark";
  let host = src;
  try {
    host = new URL(src).hostname.replace(/^www\./, "");
  } catch {
    /* 그대로 */
  }
  const ico = document.createElement("span");
  ico.className = "npd-bookmark-ico";
  ico.textContent = "🔗";
  const t = document.createElement("span");
  t.className = "npd-bookmark-text";
  const h = document.createElement("b");
  h.textContent = host;
  const s = document.createElement("span");
  s.textContent = src;
  t.append(h, s);
  a.append(ico, t);
  return a;
}
