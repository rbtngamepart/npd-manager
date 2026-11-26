"use client";

// 사진 크게 보기 (메모·진행 기록·단계 설명 어디서든 사진을 누르면)
//   배경·✕·Esc → 닫기 · 사진 누르기 → 화면 맞춤 ↔ 원래 크기
let current: { close: () => void } | null = null;

// 다른 창(큰 창·모달)의 Esc 보다 먼저 받도록 모듈을 읽을 때 한 번만 등록
if (typeof window !== "undefined") {
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || !current) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      current.close();
    },
    true
  );
}

export function isLightboxOpen() {
  return !!current;
}

export function openLightbox(src: string, alt = "") {
  if (!src) return;
  current?.close();
  const wrap = document.createElement("div");
  wrap.className = "npd-lightbox";
  wrap.setAttribute("role", "dialog");
  wrap.setAttribute("aria-modal", "true");
  wrap.setAttribute("aria-label", alt || "사진 크게 보기");

  const img = document.createElement("img");
  img.src = src;
  img.alt = alt;
  img.title = "누르면 원래 크기 / 화면 맞춤";

  const bar = document.createElement("div");
  bar.className = "npd-lightbox-bar";
  const open = document.createElement("a");
  open.href = src;
  open.target = "_blank";
  open.rel = "noopener noreferrer";
  open.textContent = "새 탭에서 열기 ↗";
  const x = document.createElement("button");
  x.type = "button";
  x.textContent = "✕";
  x.title = "닫기 (Esc)";
  bar.append(open, x);
  if (alt) {
    const cap = document.createElement("span");
    cap.textContent = alt;
    bar.prepend(cap);
  }

  const close = () => {
    wrap.remove();
    document.body.style.overflow = prevOverflow;
    if (current?.close === close) current = null;
  };
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  wrap.addEventListener("mousedown", (e) => e.stopPropagation()); // 뒤쪽 창이 '바깥 클릭'으로 닫히지 않게
  wrap.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.target === img) wrap.classList.toggle("is-full");
    else if (!(e.target as Element).closest("a")) close(); // 사진·'새 탭에서 열기' 말고 어디를 눌러도 닫힘
  });
  wrap.append(img, bar);
  document.body.appendChild(wrap);
  current = { close };
}
