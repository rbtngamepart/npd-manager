// 부서 색: 관리자 부서 목록 순서대로 고정 배정 (상태 색인 빨강·노랑·초록과 겹치지 않게)
export interface DeptColor {
  solid: string;
  light: string;
  text: string;
}

const PALETTE: DeptColor[] = [
  { solid: "#4F6BED", light: "#E5EAFD", text: "#2F48C4" }, // 인디고
  { solid: "#0E9F9A", light: "#D8F2F0", text: "#08716D" }, // 청록
  { solid: "#E07A1F", light: "#FCEBDA", text: "#A9530B" }, // 주황
  { solid: "#9B5DE5", light: "#EFE5FB", text: "#6E33B8" }, // 보라
  { solid: "#D6457A", light: "#FAE2EB", text: "#A62457" }, // 분홍
  { solid: "#2E8BC0", light: "#DCEEF8", text: "#1B648F" }, // 파랑
  { solid: "#7A9A1F", light: "#EBF2D8", text: "#56700F" }, // 올리브
  { solid: "#8A6D3B", light: "#F2EBDF", text: "#634C24" }, // 갈색
  { solid: "#5B6B7F", light: "#E6EAF0", text: "#3D4A5A" }, // 회청
  { solid: "#C2410C", light: "#FDE7DC", text: "#9A3309" }, // 벽돌
];

const NONE: DeptColor = { solid: "#CBD5E1", light: "#F1F5F9", text: "#64748B" };

/** 부서 목록을 받아 이름 → 색 함수를 만듦 */
export function makeDeptColor(list: string[]) {
  const idx = new Map<string, number>();
  list.forEach((d, i) => idx.set(d, i));
  return (name: string | null | undefined): DeptColor => {
    if (!name) return NONE;
    let i = idx.get(name);
    if (i === undefined) {
      // 목록에 없는 이름은 글자 기준으로 고정 색
      let h = 0;
      for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      i = list.length + (h % PALETTE.length);
    }
    return PALETTE[i % PALETTE.length];
  };
}

export type DeptColorFn = ReturnType<typeof makeDeptColor>;
