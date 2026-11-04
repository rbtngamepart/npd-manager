"use client";
// 구글 드라이브 파일 선택 창 (Google Picker)
// 필요한 환경변수 (Netlify, 화면용):
//   NEXT_PUBLIC_GOOGLE_CLIENT_ID  — 구글 로그인에 쓰는 OAuth 클라이언트 ID (웹 애플리케이션)
//   NEXT_PUBLIC_GOOGLE_API_KEY    — Google Picker API를 켠 API 키 (사이트 주소로 제한)
//   NEXT_PUBLIC_GOOGLE_APP_ID     — 구글 클라우드 프로젝트 번호 (숫자)

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    google?: any;
    gapi?: any;
  }
}

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? "";
const APP_ID = process.env.NEXT_PUBLIC_GOOGLE_APP_ID ?? "";
// 고른 파일에만 접근 (구글 심사가 필요 없는 범위)
const SCOPE = "https://www.googleapis.com/auth/drive.file";

export const drivePickerConfigured = !!(CLIENT_ID && API_KEY);

export interface PickedFile {
  id: string;
  name: string;
  url: string;
  mimeType: string;
}

const scripts = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  let p = scripts.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = src;
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => {
        scripts.delete(src);
        reject(new Error("구글 스크립트를 불러오지 못했습니다. 인터넷 연결이나 회사 보안 설정을 확인해 주세요."));
      };
      document.head.appendChild(el);
    });
    scripts.set(src, p);
  }
  return p;
}

let cached: { token: string; until: number; hint?: string } | null = null;

function getToken(hint?: string): Promise<string> {
  if (cached && cached.until > Date.now() + 60_000 && cached.hint === hint) return Promise.resolve(cached.token);
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      login_hint: hint,
      callback: (r: any) => {
        if (r.error) return reject(new Error(r.error === "access_denied" ? "드라이브 접근을 허용하지 않았습니다" : `구글 인증 실패: ${r.error}`));
        cached = { token: r.access_token, until: Date.now() + Number(r.expires_in ?? 3600) * 1000, hint };
        resolve(r.access_token);
      },
      error_callback: (e: any) =>
        reject(new Error(e?.type === "popup_closed" ? "구글 로그인 창을 닫았습니다" : e?.type === "popup_failed_to_open" ? "팝업이 차단됐습니다. 이 사이트의 팝업을 허용해 주세요." : "구글 인증에 실패했습니다")),
    });
    client.requestAccessToken({ prompt: cached ? "" : undefined });
  });
}

/** 선택 창 열기. 취소하면 빈 배열 */
export async function openDrivePicker(opts: { loginHint?: string; multi?: boolean } = {}): Promise<PickedFile[]> {
  if (!drivePickerConfigured) throw new Error("구글 드라이브 선택 창 설정이 아직 안 되어 있습니다 (관리자: NEXT_PUBLIC_GOOGLE_API_KEY 등 환경변수)");
  await Promise.all([loadScript("https://accounts.google.com/gsi/client"), loadScript("https://apis.google.com/js/api.js")]);
  await new Promise<void>((resolve, reject) => window.gapi.load("picker", { callback: resolve, onerror: () => reject(new Error("구글 선택 창을 불러오지 못했습니다")) }));
  const token = await getToken(opts.loginHint);
  const P = window.google.picker;

  const view = (fn: (v: any) => any, label: string) => {
    const v = fn(new P.DocsView(P.ViewId.DOCS));
    if (typeof v.setLabel === "function") v.setLabel(label);
    return v;
  };
  const views = [
    view((v) => v.setIncludeFolders(true).setSelectFolderEnabled(true).setOwnedByMe(true).setMode(P.DocsViewMode.GRID), "내 드라이브"),
    view((v) => v.setEnableDrives(true).setIncludeFolders(true).setSelectFolderEnabled(true).setMode(P.DocsViewMode.GRID), "공유 드라이브"),
    view((v) => v.setOwnedByMe(false).setIncludeFolders(true).setSelectFolderEnabled(true).setMode(P.DocsViewMode.GRID), "공유 문서함"),
    view((v) => v.setStarred(true).setIncludeFolders(true).setSelectFolderEnabled(true).setMode(P.DocsViewMode.GRID), "중요 문서함"),
    new P.DocsUploadView().setIncludeFolders(true),
  ];

  return new Promise((resolve) => {
    let b = new P.PickerBuilder()
      .setLocale("ko")
      .setTitle("Google Drive에서 연결할 파일 선택")
      .setOAuthToken(token)
      .setDeveloperKey(API_KEY)
      .setOrigin(`${window.location.protocol}//${window.location.host}`)
      .enableFeature(P.Feature.SUPPORT_DRIVES)
      .setCallback((data: any) => {
        if (data.action === P.Action.PICKED) {
          resolve(
            (data.docs ?? []).map((d: any) => ({
              id: d.id,
              name: d.name,
              url: d.url ?? `https://drive.google.com/file/d/${d.id}/view`,
              mimeType: d.mimeType,
            }))
          );
        } else if (data.action === P.Action.CANCEL) resolve([]);
      });
    if (APP_ID) b = b.setAppId(APP_ID);
    if (opts.multi !== false) b = b.enableFeature(P.Feature.MULTISELECT_ENABLED);
    for (const v of views) b = b.addView(v);
    b.build().setVisible(true);
  });
}
