import type { Candidate, ItemType } from "@/db/schema";
import { CARPET_RADIUS, STAR_Y, foliageRadius, foliageY } from "./tree-geometry";

type Vec3 = [number, number, number];

type ItemRule = {
  max: number; // 한 사람이 가질 수 있는 최대 개수 (합계 42 = 서비스 기간 42일)
  weight: number; // 후보로 뽑힐 상대 확률
  colors: string[];
  variants: string[];
  place: (rand: () => number) => Vec3;
  spot: "surface" | "floor" | "fixed"; // 같은 자리끼리는 서로 떨어뜨려 놓는다
};

const ORNAMENT_SIZE = 0.036;

export const ITEM_RULES: Record<ItemType, ItemRule> = {
  ornament: {
    max: 18,
    weight: 5,
    colors: ["red", "gold", "blue", "silver"],
    variants: ["plain", "stripe", "glitter"],
    spot: "surface",
    place: (rand) => {
      const t = 0.06 + rand() * 0.78;
      const a = rand() * Math.PI * 2;
      const r = foliageRadius(t) * 0.98 + ORNAMENT_SIZE * 0.5;
      return [Math.cos(a) * r, foliageY(t, r) - ORNAMENT_SIZE, Math.sin(a) * r];
    },
  },
  light: {
    max: 14,
    weight: 5,
    colors: ["warm", "white", "multi"],
    variants: ["steady", "twinkle"],
    spot: "surface",
    place: (rand) => {
      const t = 0.04 + rand() * 0.84;
      const a = rand() * Math.PI * 2;
      const r = foliageRadius(t) * 1.1 + 0.01;
      return [Math.cos(a) * r, foliageY(t, r), Math.sin(a) * r];
    },
  },
  gift: {
    max: 5,
    weight: 3,
    colors: ["red", "gold", "blue", "silver"],
    variants: ["small", "medium", "large"],
    spot: "floor",
    place: (rand) => floorPoint(rand),
  },
  teddy: {
    max: 2,
    weight: 2,
    colors: ["brown", "cream"],
    variants: ["red_bow", "green_bow"],
    spot: "floor",
    place: (rand) => floorPoint(rand),
  },
  carpet: {
    max: 1,
    weight: 1.5,
    colors: ["red", "green"],
    variants: ["default"],
    spot: "fixed",
    place: () => [0, 0, 0],
  },
  snow: {
    max: 1,
    weight: 1.5,
    colors: ["white"],
    variants: ["default"],
    spot: "fixed",
    place: () => [0, 0, 0],
  },
  star: {
    max: 1,
    weight: 1,
    colors: ["gold", "silver"],
    variants: ["default"],
    spot: "fixed",
    place: () => [0, STAR_Y, 0],
  },
};

const ITEM_TYPES = Object.keys(ITEM_RULES) as ItemType[];

function floorPoint(rand: () => number): Vec3 {
  const r = 0.3 + rand() * (CARPET_RADIUS - 0.38);
  const a = rand() * Math.PI * 2;
  return [Math.cos(a) * r, 0, Math.sin(a) * r];
}

const pickOne = <T,>(list: T[], rand: () => number) => list[Math.floor(rand() * list.length)];

// 이미 놓인 같은 자리 아이템들과 가장 멀리 떨어진 위치를 여러 번 뽑아서 고른다
function placeApart(rule: ItemRule, taken: Vec3[], rand: () => number): Vec3 {
  if (rule.spot === "fixed" || taken.length === 0) return rule.place(rand);
  let best = rule.place(rand);
  let bestDist = -1;
  for (let i = 0; i < 24; i++) {
    const p = rule.place(rand);
    const d = Math.min(...taken.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])));
    if (d > bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export type PlacedItem = { itemType: ItemType; pos: Vec3 };

/**
 * 오늘의 후보 3개를 만든다.
 * - 최대 개수가 찬 종류는 빼고, 남은 종류 중 서로 다른 3개를 가중치에 따라 뽑는다.
 * - 남은 종류가 3개보다 적으면 같은 종류를 다른 색으로 채운다.
 * 남은 종류가 하나도 없으면 null.
 */
export function makeCandidates(placed: PlacedItem[], rand: () => number = Math.random): Candidate[] | null {
  const count = new Map<ItemType, number>();
  for (const p of placed) count.set(p.itemType, (count.get(p.itemType) ?? 0) + 1);
  const pool = ITEM_TYPES.filter((type) => (count.get(type) ?? 0) < ITEM_RULES[type].max);
  if (pool.length === 0) return null;

  const types: ItemType[] = [];
  const remaining = [...pool];
  while (types.length < 3 && remaining.length > 0) {
    const total = remaining.reduce((sum, type) => sum + ITEM_RULES[type].weight, 0);
    let roll = rand() * total;
    const index = remaining.findIndex((type) => (roll -= ITEM_RULES[type].weight) < 0);
    types.push(...remaining.splice(index === -1 ? remaining.length - 1 : index, 1));
  }
  while (types.length < 3) types.push(pickOne(pool, rand));

  const usedColors = new Map<ItemType, Set<string>>();
  return types.map((itemType) => {
    const rule = ITEM_RULES[itemType];
    const used = usedColors.get(itemType) ?? new Set<string>();
    usedColors.set(itemType, used);
    const fresh = rule.colors.filter((c) => !used.has(c));
    const color = pickOne(fresh.length > 0 ? fresh : rule.colors, rand);
    used.add(color);

    const taken = placed.filter((p) => ITEM_RULES[p.itemType].spot === rule.spot).map((p) => p.pos);
    const pos = placeApart(rule, taken, rand).map(round) as Vec3;
    return { itemType, color, variant: pickOne(rule.variants, rand), pos };
  });
}
