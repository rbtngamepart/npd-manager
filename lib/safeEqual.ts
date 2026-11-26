import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/** 비밀값 비교 (걸린 시간으로 값을 짐작하지 못하게) */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
