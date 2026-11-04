// 붙여넣은 링크가 무엇인지 알아보고, 구글 드라이브 계열이면 미리보기 주소를 만듦

export type LinkKind = "doc" | "sheet" | "slide" | "form" | "drive" | "folder" | "pdf" | "figma" | "jira" | "confluence" | "web";

export interface LinkInfo {
  kind: LinkKind;
  icon: string;
  label: string;
  /** 패널 안에서 바로 볼 수 있는 주소 (없으면 새 창으로만) */
  preview: string | null;
}

const META: Record<LinkKind, { icon: string; label: string }> = {
  doc: { icon: "📄", label: "구글 문서" },
  sheet: { icon: "📊", label: "구글 시트" },
  slide: { icon: "📽️", label: "구글 슬라이드" },
  form: { icon: "📝", label: "구글 설문지" },
  drive: { icon: "📁", label: "드라이브 파일" },
  folder: { icon: "🗂️", label: "드라이브 폴더" },
  pdf: { icon: "📕", label: "PDF" },
  figma: { icon: "🎨", label: "Figma" },
  jira: { icon: "🟦", label: "Jira" },
  confluence: { icon: "📘", label: "Confluence" },
  web: { icon: "🔗", label: "링크" },
};

export function linkInfo(raw: string): LinkInfo {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ...META.web, kind: "web", preview: null };
  }
  const host = u.hostname.replace(/^www\./, "");
  const path = u.pathname;
  const mk = (kind: LinkKind, preview: string | null): LinkInfo => ({ ...META[kind], kind, preview });

  if (host === "docs.google.com") {
    const m = path.match(/^\/(document|spreadsheets|presentation|forms)\/(?:u\/\d+\/)?d\/(e\/)?([\w-]+)/);
    if (m) {
      const [, type, published, id] = m;
      const base = `https://docs.google.com/${type}/d/${published ?? ""}${id}`;
      if (type === "document") return mk("doc", `${base}/preview`);
      if (type === "spreadsheets") return mk("sheet", `${base}/preview`);
      if (type === "presentation") return mk("slide", `${base}/preview`);
      return mk("form", `${base}/viewform?embedded=true`);
    }
  }
  if (host === "drive.google.com") {
    const file = path.match(/\/file\/d\/([\w-]+)/)?.[1] ?? (path === "/open" || path === "/uc" ? u.searchParams.get("id") : null);
    if (file) return mk("drive", `https://drive.google.com/file/d/${file}/preview`);
    const folder = path.match(/\/folders\/([\w-]+)/)?.[1];
    if (folder) return mk("folder", `https://drive.google.com/embeddedfolderview?id=${folder}#list`);
  }
  if (host === "figma.com" && /^\/(file|design|proto|board)\//.test(path)) {
    return mk("figma", `https://www.figma.com/embed?embed_host=npd&url=${encodeURIComponent(u.toString())}`);
  }
  if (host.endsWith("atlassian.net")) return mk(path.startsWith("/wiki") ? "confluence" : "jira", null);
  if (/\.pdf$/i.test(path)) return mk("pdf", u.toString());
  return mk("web", null);
}

/** 제목을 안 적었을 때 보여줄 이름 */
export function linkTitle(url: string, title?: string | null): string {
  if (title?.trim()) return title.trim();
  const info = linkInfo(url);
  if (info.kind !== "web") return info.label;
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "") + (u.pathname.length > 1 ? decodeURIComponent(u.pathname).slice(0, 40) : "");
  } catch {
    return url;
  }
}
