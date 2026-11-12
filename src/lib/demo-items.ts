import type { Candidate } from "@/db/schema";
import { makeCandidates } from "./items";
import { mulberry32 } from "./random";

// 로그인 전 데모: 실제 규칙대로 42일을 매일 골랐을 때의 완성된 트리
function makeDemoItems(seed: number): Candidate[] {
  const rand = mulberry32(seed);
  const placed: Candidate[] = [];
  for (let day = 0; day < 42; day++) {
    const candidates = makeCandidates(placed, rand);
    if (!candidates) break;
    placed.push(candidates[Math.floor(rand() * candidates.length)]);
  }
  return placed;
}

export const DEMO_ITEMS = makeDemoItems(1225);
