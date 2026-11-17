// NPD 캘린더 도우미 — 구글 캘린더 화면에 'NPD' 버튼과 단계 고르기 창을 붙임
(() => {
  if (window.__npdHelper) return;
  window.__npdHelper = true;

  const LAST_PROJECT = "npd-last-project";
  const TITLE_LABELS = /^(제목|제목 추가|add title|title)$/i;
  const DESC_LABELS = /^(설명|설명 추가|description|add description)$/i;

  // ---------------------------------------------------------------
  // 화면 틀 (Shadow DOM: 캘린더 화면 스타일과 섞이지 않게)
  // ---------------------------------------------------------------
  const host = document.createElement("div");
  host.id = "npd-helper-root";
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483000;";
  document.documentElement.appendChild(host);
  // 확장 창을 누를 때 구글 캘린더의 '바깥 클릭' 처리(상세 창 닫기 등)로 새지 않게
  ["mousedown", "mouseup", "pointerdown", "pointerup", "click", "touchstart"].forEach((t) => host.addEventListener(t, (e) => e.stopPropagation()));
  const root = host.attachShadow({ mode: "open" });

  root.innerHTML = `
  <style>
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, "Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; }
    .fab { position: fixed; left: 16px; bottom: 16px; pointer-events: auto; display:flex; align-items:center; gap:6px;
      background:#0f172a; color:#fff; border:0; border-radius:999px; padding:8px 13px 8px 9px; font-size:12px; font-weight:700;
      box-shadow: 0 6px 18px rgba(0,0,0,.18); cursor:pointer; opacity:.9; }
    .fab:hover { opacity:1; }
    .dot { width:18px; height:18px; border-radius:5px; background:#e8352c; display:grid; place-items:center; font-size:10px; font-weight:800; }
    .chip { position: fixed; pointer-events: auto; display:none; align-items:center; gap:5px; background:#e8352c; color:#fff; border:0;
      border-radius:8px; padding:5px 9px; font-size:12px; font-weight:700; cursor:pointer; box-shadow: 0 4px 12px rgba(232,53,44,.35); }
    .chip.show { display:flex; }
    .back { position: fixed; inset:0; background: rgba(15,23,42,.28); pointer-events:auto; display:none; }
    .back.show { display:block; }
    .panel { position: fixed; top: 8vh; left: 50%; transform: translateX(-50%); width: min(560px, calc(100vw - 24px)); max-height: 84vh;
      background:#fff; border-radius:14px; box-shadow: 0 24px 60px rgba(0,0,0,.25); display:flex; flex-direction:column; overflow:hidden; color:#0f172a; }
    .hd { display:flex; align-items:center; gap:8px; padding:12px 14px; border-bottom:1px solid rgba(0,0,0,.07); }
    .hd b { font-size:14px; }
    .hd .who { color:#64748b; font-size:12px; }
    .hd .sp { flex:1; }
    .ib { background:none; border:0; color:#64748b; cursor:pointer; font-size:12px; padding:4px 6px; border-radius:6px; }
    .ib:hover { background:#f1f5f9; color:#0f172a; }
    .bar { display:flex; gap:8px; padding:10px 14px; border-bottom:1px solid rgba(0,0,0,.06); }
    input[type=text], select { border:1px solid rgba(0,0,0,.14); border-radius:9px; padding:8px 10px; font-size:13px; color:#0f172a; background:#fff; min-width:0; }
    input[type=text]:focus, select:focus { outline:none; border-color:#e8352c; box-shadow:0 0 0 3px rgba(232,53,44,.14); }
    .q { flex:1; }
    .proj { width: 42%; }
    .list { overflow:auto; flex:1; min-height: 140px; padding: 4px 0; }
    .it { display:flex; align-items:center; gap:8px; padding:7px 14px; cursor:pointer; font-size:13px; }
    .it:hover, .it.on { background:#fef2f2; }
    .it.on { box-shadow: inset 3px 0 0 #e8352c; }
    .it .nm { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .it .pt { color:#94a3b8; font-size:11px; }
    .it .dt { color:#94a3b8; font-size:11px; white-space:nowrap; font-variant-numeric: tabular-nums; }
    .it.done .nm { color:#94a3b8; text-decoration: line-through; }
    .tag { font-size:10px; border-radius:5px; padding:1px 5px; background:#f1f5f9; color:#475569; white-space:nowrap; }
    .cal { font-size:11px; }
    .ph { color:#94a3b8; font-size:12px; text-align:center; padding: 26px 14px; line-height:1.6; }
    .ft { border-top:1px solid rgba(0,0,0,.07); padding:10px 14px 12px; display:flex; flex-direction:column; gap:8px; background:#f8fafc; }
    .ft .r { display:flex; gap:8px; align-items:center; flex-wrap: wrap; }
    .ft label { font-size:12px; color:#334155; display:flex; align-items:center; gap:4px; cursor:pointer; }
    .pv { font-size:13px; font-weight:600; background:#fff; border:1px dashed rgba(0,0,0,.15); border-radius:9px; padding:7px 10px; min-height: 34px; word-break: break-all; }
    .pv .muted { color:#94a3b8; font-weight:400; }
    .det { flex:1; }
    .go { background:#e8352c; color:#fff; border:0; border-radius:9px; padding:8px 14px; font-size:13px; font-weight:700; cursor:pointer; }
    .go:disabled { opacity:.4; cursor:default; }
    .sec { background:#e2e8f0; color:#334155; border:0; border-radius:9px; padding:8px 12px; font-size:13px; font-weight:600; cursor:pointer; }
    .err { margin: 12px 14px; padding:10px 12px; border-radius:10px; background:#fff1f2; color:#9f1239; font-size:12px; line-height:1.6; }
    .warn { margin: 8px 14px 0; padding:6px 10px; border-radius:8px; background:#fffbeb; color:#92400e; font-size:11px; }
    .toast { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); background:#0f172a; color:#fff; padding:9px 14px; border-radius:10px;
      font-size:13px; box-shadow:0 10px 30px rgba(0,0,0,.25); pointer-events:none; opacity:0; transition: opacity .2s; max-width: 90vw; }
    .toast.show { opacity:1; }
    .kbd { font-size:11px; color:#94a3b8; }
  </style>
  <button class="fab" title="NPD 단계 고르기 (Alt+N)"><span class="dot">N</span>NPD</button>
  <button class="chip" title="NPD 프로젝트·단계 고르기"><span>NPD 단계</span></button>
  <div class="back">
    <div class="panel" role="dialog" aria-label="NPD 단계 고르기">
      <div class="hd"><b>NPD 단계 고르기</b><span class="who"></span><span class="sp"></span>
        <button class="ib" data-a="refresh" title="NPD에서 다시 불러오기">↻ 새로고침</button>
        <button class="ib" data-a="close" title="닫기 (Esc)">✕</button></div>
      <div class="bar"><select class="proj"></select><input class="q" type="text" placeholder="단계 검색 (모든 프로젝트)" /></div>
      <div class="msg"></div>
      <div class="list"></div>
      <div class="ft">
        <div class="r"><input class="det" type="text" placeholder="세부 (선택) 예: 1차 평가, 킥오프 회의" /></div>
        <div class="r">
          <label><input type="checkbox" class="done" /> 완료 ✅</label>
          <label><input type="checkbox" class="link" checked /> 설명에 NPD 단계 링크</label>
          <span class="sp" style="flex:1"></span><span class="kbd">Enter 넣기 · Esc 닫기</span>
        </div>
        <div class="pv"><span class="muted">단계를 고르면 제목 미리보기가 나옵니다</span></div>
        <div class="r" style="justify-content:flex-end">
          <button class="sec" data-a="copy">제목 복사</button>
          <button class="go" data-a="apply" disabled>제목에 넣기</button>
        </div>
      </div>
    </div>
  </div>
  <div class="toast"></div>`;

  const $ = (s) => root.querySelector(s);
  const fab = $(".fab");
  const chip = $(".chip");
  const back = $(".back");
  const listEl = $(".list");
  const projSel = $(".proj");
  const q = $(".q");
  const det = $(".det");
  const doneCb = $(".done");
  const linkCb = $(".link");
  const pv = $(".pv");
  const goBtn = $('[data-a="apply"]');
  const msg = $(".msg");
  const toastEl = $(".toast");

  let data = null; // { user, site, projects }
  let target = null; // 제목 입력칸
  let picked = null; // { project, stage }
  let cursor = 0;
  let shown = [];

  function toast(t) {
    toastEl.textContent = t;
    toastEl.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.remove("show"), 2800);
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const md = (d) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "");

  // ---------------------------------------------------------------
  // 구글 캘린더 입력칸 찾기
  // ---------------------------------------------------------------
  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const labelOf = (el) => (el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").trim();

  function findTitleInputs() {
    return Array.from(document.querySelectorAll("input[type=text], input:not([type]), textarea")).filter((el) => TITLE_LABELS.test(labelOf(el)) && visible(el));
  }
  function findTitle() {
    if (target && visible(target)) return target;
    return findTitleInputs()[0] || null;
  }
  function findDesc() {
    const cands = Array.from(document.querySelectorAll('[contenteditable="true"], textarea')).filter((el) => DESC_LABELS.test(labelOf(el)) && visible(el));
    return cands[0] || null;
  }

  function setInputValue(el, v) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    el.focus();
    setter.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function appendToDesc(el, text) {
    const current = el.innerText || el.value || "";
    if (current.includes(text)) return true;
    el.focus();
    if (el instanceof HTMLTextAreaElement) {
      setInputValue(el, (current ? current.replace(/\s+$/, "") + "\n" : "") + text);
      return true;
    }
    // 내용 끝으로 커서를 옮긴 뒤 입력 (구글 편집기가 알아차리도록)
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    return document.execCommand("insertText", false, (current.trim() ? "\n" : "") + text);
  }

  // 제목 칸에 커서가 가면 옆에 'NPD 단계' 버튼
  const MORE_LABELS = /^(옵션 더보기|more options)$/i;
  // 새 일정 간단 입력 창의 [옵션 더보기] 버튼
  function moreOptionsBtn() {
    if (!target) return null;
    const box = target.closest('[role="dialog"]') || target.closest("form") || document;
    return (
      Array.from(box.querySelectorAll('button, [role="button"]')).find(
        (b) => (MORE_LABELS.test((b.textContent || "").trim()) || MORE_LABELS.test(labelOf(b))) && visible(b)
      ) || null
    );
  }
  function placeChip() {
    if (!target || !visible(target)) return chip.classList.remove("show");
    chip.classList.add("show");
    const c = chip.getBoundingClientRect();
    const more = moreOptionsBtn();
    if (more) {
      // 새 일정 창: [옵션 더보기] 왼쪽
      const m = more.getBoundingClientRect();
      chip.style.top = `${m.top + (m.height - c.height) / 2}px`;
      chip.style.left = `${Math.max(4, m.left - c.width - 10)}px`;
      return;
    }
    // 수정 화면: 제목 칸 안쪽 오른쪽 끝 (오른쪽 [저장] 버튼과 겹치지 않게)
    const r = target.getBoundingClientRect();
    chip.style.top = `${Math.max(4, r.top + (r.height - c.height) / 2)}px`;
    chip.style.left = `${Math.max(r.left, r.right - c.width - 6)}px`;
  }
  document.addEventListener(
    "focusin",
    (e) => {
      const el = e.target;
      if (el && el.matches && el.matches("input, textarea") && TITLE_LABELS.test(labelOf(el))) {
        target = el;
        placeChip();
      }
    },
    true
  );
  document.addEventListener(
    "focusout",
    (e) => {
      if (e.target === target)
        setTimeout(() => {
          // 새 일정 창은 열려 있는 동안 계속 보이게
          if (document.activeElement !== target && !back.classList.contains("show") && !moreOptionsBtn()) chip.classList.remove("show");
        }, 200);
    },
    true
  );
  window.addEventListener("resize", () => chip.classList.contains("show") && placeChip());
  document.addEventListener("scroll", () => chip.classList.contains("show") && placeChip(), true);
  chip.addEventListener("mousedown", (e) => e.preventDefault());

  // ---------------------------------------------------------------
  // 단계 고르기 창
  // ---------------------------------------------------------------
  function titleFor(p, s) {
    if (!p || !s) return "";
    const d = det.value.trim();
    return `[${p.tag}] ${s.name}${d ? ` - ${d}` : ""}${doneCb.checked ? " ✅" : ""}`;
  }
  function updatePreview() {
    const t = picked ? titleFor(picked.project, picked.stage) : "";
    pv.innerHTML = t ? esc(t) : '<span class="muted">단계를 고르면 제목 미리보기가 나옵니다</span>';
    goBtn.disabled = !t;
  }

  function render() {
    msg.innerHTML = "";
    if (!data) return;
    const term = q.value.trim().toLowerCase();
    const pid = projSel.value;
    shown = [];
    for (const p of data.projects) {
      if (!term && p.id !== pid) continue;
      for (const s of p.stages) {
        if (s.skipped) continue;
        const hay = `${p.name} ${p.tag} ${s.path} ${s.name} ${s.code || ""}`.toLowerCase();
        if (term && !term.split(/\s+/).every((w) => hay.includes(w))) continue;
        shown.push({ project: p, stage: s });
      }
    }
    if (!shown.length) {
      listEl.innerHTML = `<div class="ph">${
        term ? "찾는 단계가 없습니다." : "이 프로젝트에 단계가 없습니다.<br>NPD에서 단계를 먼저 만들어 주세요."
      }</div>`;
      return;
    }
    cursor = Math.min(cursor, shown.length - 1);
    listEl.innerHTML = shown
      .map((x, i) => {
        const s = x.stage;
        const indent = term ? 14 : 14 + s.depth * 14;
        const sel = picked && picked.stage.id === s.id;
        return `<div class="it ${sel || i === cursor ? "on" : ""} ${s.done ? "done" : ""}" data-i="${i}" style="padding-left:${indent}px">
          <span class="nm">${esc(s.name)}${term || s.path ? `<br><span class="pt">${esc(term ? `${x.project.name}${s.path ? " › " + s.path : ""}` : s.path)}</span>` : ""}</span>
          ${s.calendar ? '<span class="cal" title="이미 캘린더 일정과 연결된 단계">📅</span>' : ""}
          ${term ? `<span class="tag">[${esc(x.project.tag)}]</span>` : ""}
          <span class="dt">${s.plan_start ? `${md(s.plan_start)}~${md(s.plan_end)}` : ""}</span>
        </div>`;
      })
      .join("");
  }

  function fillProjects() {
    const last = localStorage.getItem(LAST_PROJECT);
    projSel.innerHTML = data.projects
      .map((p) => `<option value="${esc(p.id)}">[${esc(p.tag)}] ${esc(p.name)}${p.category ? ` · ${esc(p.category)}` : ""}</option>`)
      .join("");
    if (last && data.projects.some((p) => p.id === last)) projSel.value = last;
    $(".who").textContent = data.user ? `· ${data.user}` : "";
  }

  async function load(force) {
    listEl.innerHTML = '<div class="ph">불러오는 중…</div>';
    let r;
    try {
      r = await chrome.runtime.sendMessage({ type: "catalog", force });
    } catch (e) {
      r = { ok: false, error: "확장 프로그램이 업데이트됐습니다. 이 탭을 새로고침해 주세요." };
    }
    if (!r || !r.ok) {
      data = null;
      listEl.innerHTML = "";
      msg.innerHTML = `<div class="err">${esc((r && r.error) || "불러오지 못했습니다")}${
        r && r.needSetup ? '<br><button class="sec" data-a="options" style="margin-top:8px">설정 열기</button>' : ""
      }</div>`;
      return;
    }
    data = r.data;
    fillProjects();
    render();
    if (r.warn) msg.innerHTML = `<div class="warn">${esc(r.warn)}</div>`;
    if (!data.projects.length) listEl.innerHTML = '<div class="ph">진행 중인 프로젝트가 없습니다.</div>';
  }

  // 상세 창에서 열었을 때: 그 일정 제목 (제목 칸이 없음 → 고른 결과는 수정 화면이 열릴 때 넣음)
  let fromBubble = null;
  function open(presetTitle) {
    fromBubble = typeof presetTitle === "string" ? presetTitle : null;
    target = fromBubble !== null ? null : findTitle() || target;
    picked = null;
    cursor = 0;
    q.value = "";
    doneCb.checked = false;
    // 제목에 먼저 적어둔 글은 '세부'로 (이미 말머리가 있으면 떼고)
    const cur = fromBubble !== null ? fromBubble.trim() : target ? target.value.trim() : "";
    const m = cur.match(/^\s*[[【［]\s*([^\]】］]+?)\s*[\]】］]\s*(.*)$/);
    let rest = m ? m[2] : cur;
    if (/✅|\(완료\)/.test(rest)) {
      doneCb.checked = true;
      rest = rest.replace(/✅|\(완료\)/g, "").trim();
    }
    det.value = m ? (rest.split(/\s+[-–>]\s+/).slice(1).join(" - ") || "") : rest;
    back.classList.add("show");
    chip.classList.remove("show");
    updatePreview();
    load(false).then(() => {
      // 이미 말머리가 있으면 그 프로젝트·단계를 미리 골라 둠
      if (data && m) {
        const tag = m[1].trim().toLowerCase();
        const p = data.projects.find((x) => x.tags.concat([x.name]).some((t) => t.toLowerCase() === tag));
        if (p) {
          projSel.value = p.id;
          const name = (rest.split(/\s+[-–>]\s+/)[0] || "").trim();
          const s = p.stages.find((x) => x.name === name);
          if (s) picked = { project: p, stage: s };
          else det.value = rest; // 단계명이 NPD에 없으면 뒤 글자를 통째로 세부로
          render();
          updatePreview();
        } else {
          // NPD 말머리가 아닌 괄호(예: [본사])면 원래 제목을 그대로 세부로 보존
          det.value = cur.replace(/✅|\(완료\)/g, "").trim();
          updatePreview();
        }
      }
      q.focus();
    });
  }
  function close() {
    back.classList.remove("show");
    fromBubble = null;
    if (target && visible(target)) target.focus();
  }

  async function apply(copyOnly) {
    if (!picked) return;
    const t = titleFor(picked.project, picked.stage);
    localStorage.setItem(LAST_PROJECT, picked.project.id);
    if (!copyOnly && fromBubble !== null) {
      // 상세 창에서 고른 경우: ✎ 수정을 누르면 열리는 화면의 제목 칸에 자동으로 넣음
      pending = { title: t, link: linkCb.checked && data && picked.stage.code ? `NPD 단계: ${data.site}/s/${picked.stage.code}` : null, until: Date.now() + 3 * 60 * 1000 };
      try {
        await navigator.clipboard.writeText(t);
      } catch {
        /* 복사 못 해도 자동 입력은 됨 */
      }
      back.classList.remove("show");
      toast("✎(수정)을 누르면 열리는 화면의 제목에 자동으로 넣어요 · 클립보드에도 복사됨");
      return;
    }
    const el = copyOnly ? null : findTitle();
    if (!el) {
      try {
        await navigator.clipboard.writeText(t);
        toast(copyOnly ? "제목을 복사했습니다" : "제목 칸을 찾지 못해 복사했습니다. 제목 칸에 붙여넣으세요 (Ctrl+V)");
      } catch {
        toast("제목: " + t);
      }
      close();
      return;
    }
    setInputValue(el, t);
    let note = "";
    if (linkCb.checked && data && picked.stage.code) {
      const d = findDesc();
      const line = `NPD 단계: ${data.site}/s/${picked.stage.code}`;
      if (d) appendToDesc(d, line);
      else note = " (설명 칸이 닫혀 있어 링크는 넣지 않았어요)";
    }
    back.classList.remove("show");
    el.focus();
    toast(`제목을 넣었습니다${note}`);
  }

  // 이벤트
  fab.addEventListener("click", open);
  chip.addEventListener("click", open);
  back.addEventListener("mousedown", (e) => e.target === back && close());
  root.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("[data-a]");
    if (a) {
      const act = a.getAttribute("data-a");
      if (act === "close") close();
      if (act === "refresh") load(true);
      if (act === "apply") apply(false);
      if (act === "copy") apply(true);
      if (act === "options") chrome.runtime.sendMessage({ type: "openOptions" });
      return;
    }
    const it = e.target.closest && e.target.closest(".it");
    if (it) {
      const x = shown[Number(it.getAttribute("data-i"))];
      if (!x) return;
      if (picked && picked.stage.id === x.stage.id) return apply(false); // 두 번 누르면 바로 넣기
      picked = x;
      cursor = Number(it.getAttribute("data-i"));
      render();
      updatePreview();
      det.focus();
    }
  });
  projSel.addEventListener("change", () => {
    localStorage.setItem(LAST_PROJECT, projSel.value);
    cursor = 0;
    render();
  });
  q.addEventListener("input", () => {
    cursor = 0;
    picked = null; // 검색하면 새로 고르기
    render();
    updatePreview();
  });
  det.addEventListener("input", updatePreview);
  doneCb.addEventListener("change", updatePreview);

  root.addEventListener("keydown", (e) => {
    if (!back.classList.contains("show")) return;
    e.stopPropagation(); // 캘린더 단축키가 같이 눌리지 않게
    if (e.key === "Escape") return close();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!shown.length) return;
      cursor = (cursor + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length;
      picked = shown[cursor];
      render();
      updatePreview();
      const el = listEl.querySelector(`[data-i="${cursor}"]`);
      el && el.scrollIntoView({ block: "nearest" });
    }
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      if (!picked && shown[cursor]) {
        picked = shown[cursor];
        render();
        updatePreview();
        det.focus();
        return;
      }
      apply(false);
    }
  });
  // 창 밖의 키 입력이 캘린더로 새지 않게
  ["keyup", "keypress"].forEach((t) => root.addEventListener(t, (e) => back.classList.contains("show") && e.stopPropagation()));

  chrome.runtime.onMessage.addListener((m) => {
    if (m && m.type === "open") open();
  });

  // ---------------------------------------------------------------
  // 일정을 눌렀을 때 뜨는 상세 창: 버튼 줄 왼쪽에 'N' 버튼
  //   구글 화면(✎ 수정 등)은 건드리지 않고, 확장 프로그램 쪽에서 따로 띄움
  //   N → 단계 고르기 → 사용자가 ✎(수정)을 누르면 열리는 화면의 제목에 자동 입력
  // ---------------------------------------------------------------
  const EDIT_LABELS = /^(일정 수정|일정 편집|수정|edit event|edit)$/i;
  const DELETE_LABELS = /^(일정 삭제|삭제|delete event|delete)$/i;
  let pending = null; // { title, link, until }

  const bn = document.createElement("button");
  bn.className = "bn";
  bn.title = "NPD 단계 고르기";
  bn.setAttribute("aria-label", "NPD 단계 고르기");
  bn.innerHTML =
    '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M5 19V5h2.7l6.9 9.7V5H17.4v14h-2.7L7.8 9.3V19z" fill="currentColor"/><circle cx="19.5" cy="5" r="2.5" fill="#f87171"/></svg>';
  root.appendChild(bn);
  const bnStyle = document.createElement("style");
  bnStyle.textContent = `.bn{position:fixed;display:none;pointer-events:auto;border:0;border-radius:50%;padding:0;cursor:pointer;place-items:center;background:transparent;}
    .bn.show{display:grid}.bn:hover{background:rgba(127,127,127,.18)}`;
  root.appendChild(bnStyle);

  let bubble = null; // { bar, edit, title }
  function findBubble() {
    const edits = Array.from(document.querySelectorAll('[role="button"][aria-label], button[aria-label]')).filter((el) => EDIT_LABELS.test(labelOf(el)) && visible(el));
    for (const edit of edits) {
      let bar = edit.parentElement;
      for (let i = 0; i < 5 && bar; i++) {
        if (Array.from(bar.querySelectorAll("[aria-label]")).some((x) => DELETE_LABELS.test(labelOf(x)))) break;
        bar = bar.parentElement;
      }
      if (!bar || !visible(bar)) continue;
      const box = edit.closest('[role="dialog"]') || bar.parentElement;
      const h = box && box.querySelector('[role="heading"]');
      return { bar, edit, box, title: h ? h.textContent.trim() : "" };
    }
    return null;
  }
  function placeBubbleBtn() {
    bubble = findBubble();
    if (!bubble || back.classList.contains("show")) return bn.classList.remove("show");
    // 버튼 줄의 맨 왼쪽 버튼 기준으로, 그 왼쪽에
    const btns = Array.from(bubble.bar.querySelectorAll('[role="button"][aria-label], button[aria-label]')).filter(visible);
    const first = btns.reduce((a, b) => (b.getBoundingClientRect().left < a.getBoundingClientRect().left ? b : a), bubble.edit);
    const r = first.getBoundingClientRect();
    const ref = bubble.edit;
    const cs = getComputedStyle(ref);
    const size = Math.round(r.height) || 40;
    bn.style.width = `${size}px`;
    bn.style.height = `${size}px`;
    bn.style.color = cs.color;
    bn.style.top = `${r.top}px`;
    bn.style.left = `${r.left - size - 4}px`;
    bn.classList.add("show");
  }
  // 누를 때 상세 창이 닫히지 않게 (구글은 바깥 클릭으로 닫음)
  ["mousedown", "pointerdown", "mouseup", "pointerup"].forEach((t) =>
    bn.addEventListener(t, (e) => {
      e.preventDefault();
      e.stopPropagation();
    })
  );
  bn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const b = bubble || findBubble();
    open(b ? b.title : "");
    bn.classList.remove("show");
  });

  // ✎ 수정 화면이 열리면 고른 제목을 자동으로
  async function fillPending() {
    if (!pending || Date.now() > pending.until) return (pending = null);
    const el = findTitleInputs()[0];
    if (!el) return;
    const p = pending;
    pending = null;
    setInputValue(el, p.title);
    let note = "";
    if (p.link) {
      const d = findDesc();
      if (d) appendToDesc(d, p.link);
      else note = " (설명 칸이 닫혀 있어 링크는 넣지 않았어요)";
    }
    el.focus();
    toast(`NPD 제목을 넣었습니다. 확인 후 [저장]을 눌러주세요${note}`);
  }

  let scanTimer = null;
  const scan = () => {
    try {
      placeBubbleBtn();
      fillPending();
      if (chip.classList.contains("show")) {
        if (!target || !target.isConnected || !visible(target)) chip.classList.remove("show");
        else placeChip();
      }
    } catch {
      /* 캘린더 화면 구조가 달라도 다른 기능은 그대로 */
    }
  };
  new MutationObserver(() => {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, 200);
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "aria-hidden"] });
  window.addEventListener("resize", scan);
  document.addEventListener("scroll", scan, true);
  scan();
})();
