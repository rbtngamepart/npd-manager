// NPD 캘린더 도우미 — 백그라운드: NPD에서 프로젝트·단계 목록 받아오기
const FRESH_MS = 5 * 60 * 1000;

async function getConfig() {
  const { site, token, cache, cachedAt } = await chrome.storage.local.get(["site", "token", "cache", "cachedAt"]);
  return { site, token, cache, cachedAt };
}

async function fetchCatalog(force) {
  const { site, token, cache, cachedAt } = await getConfig();
  if (!site || !token) return { ok: false, needSetup: true, error: "아직 연결되지 않았습니다. 확장 프로그램 설정에 NPD 연결 코드를 넣어 주세요." };
  if (!force && cache && cachedAt && Date.now() - cachedAt < FRESH_MS) return { ok: true, data: cache, cached: true };
  try {
    const r = await fetch(`${site}/api/ext/catalog`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, needSetup: r.status === 401, error: j.error || `NPD 응답 ${r.status}` };
    await chrome.storage.local.set({ cache: j, cachedAt: Date.now() });
    return { ok: true, data: j };
  } catch (e) {
    // 인터넷이 잠깐 끊겨도 예전 목록으로
    if (cache) return { ok: true, data: cache, cached: true, warn: "NPD에 연결하지 못해 이전 목록을 보여줍니다" };
    return { ok: false, error: `NPD에 연결하지 못했습니다 (${e && e.message ? e.message : e})` };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  if (msg && msg.type === "catalog") {
    fetchCatalog(!!msg.force).then(send);
    return true;
  }
  if (msg && msg.type === "openOptions") {
    chrome.runtime.openOptionsPage();
    send({ ok: true });
  }
  return false;
});

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== "open-picker") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id && /^https:\/\/calendar\.google\.com\//.test(tab.url || "")) chrome.tabs.sendMessage(tab.id, { type: "open" });
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onInstalled.addListener(async (d) => {
  if (d.reason === "install") chrome.runtime.openOptionsPage();
});
