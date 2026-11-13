const $ = (id) => document.getElementById(id);

function parseCode(raw) {
  const v = (raw || "").trim();
  // NPD1.<사이트 주소 base64url>.<64자리 코드>
  const m = v.match(/^NPD1\.([A-Za-z0-9_-]+)\.([0-9a-f]{64})$/);
  if (!m) return null;
  try {
    const site = atob(m[1].replace(/-/g, "+").replace(/_/g, "/")).replace(/\/$/, "");
    if (!/^https:\/\/[a-z0-9.-]+\.netlify\.app$/i.test(site)) return null;
    return { site, token: m[2] };
  } catch {
    return null;
  }
}

function show(kind, text) {
  const s = $("status");
  s.className = `status ${kind}`;
  s.textContent = text;
}

async function test() {
  show("ok", "확인 중…");
  const r = await chrome.runtime.sendMessage({ type: "catalog", force: true });
  if (r && r.ok) {
    const n = r.data.projects.length;
    const st = r.data.projects.reduce((a, p) => a + p.stages.length, 0);
    show("ok", `연결됨 · ${r.data.user}님 · 진행 중 프로젝트 ${n}개, 단계 ${st}개. 이제 구글 캘린더를 새로고침하세요.`);
  } else show("err", (r && r.error) || "연결하지 못했습니다");
}

$("save").onclick = async () => {
  const c = parseCode($("code").value);
  if (!c) return show("err", "연결 코드 형식이 아닙니다. NPD에서 받은 코드(NPD1.…)를 그대로 붙여넣어 주세요.");
  await chrome.storage.local.set({ site: c.site, token: c.token, cache: null, cachedAt: 0 });
  test();
};
$("test").onclick = test;
$("clear").onclick = async () => {
  await chrome.storage.local.remove(["site", "token", "cache", "cachedAt"]);
  $("code").value = "";
  show("ok", "연결을 해제했습니다.");
};

chrome.storage.local.get(["site", "token"]).then(({ site, token }) => {
  if (site && token) {
    $("code").placeholder = `연결됨: ${site} (바꾸려면 새 코드를 붙여넣으세요)`;
    test();
  }
});
