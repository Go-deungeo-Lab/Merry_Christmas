import type { ItemType } from "@/db/schema";
import { mulberry32 } from "@/lib/random";
import {
  CARPET_RADIUS,
  FLOOR_RADIUS,
  FOLIAGE_BOTTOM,
  FOLIAGE_TOP,
  TRUNK_HEIGHT,
  TRUNK_RADIUS,
  foliageRadius,
  foliageY,
} from "@/lib/tree-geometry";

// ASCII 트리와 아이템 미리보기가 함께 쓰는 3D 점 구름 장면.
// 점을 만들고(build*), 회전·투영된 점 하나의 문자와 색을 정한다(shadePoint).

export type TreeItem = {
  itemType: ItemType;
  color: string;
  variant: string;
  pos: [number, number, number];
};

export type Vec3 = [number, number, number];
export type Placement = { x: number; z: number; yaw: number };

export const MAT_LEAF = 0;
export const MAT_ORNAMENT = 1;
export const MAT_LIGHT = 2;
export const MAT_WOOD = 3;
export const MAT_GIFT = 4;
export const MAT_FUR = 5;
export const MAT_FLOOR = 6;
export const MAT_CARPET = 7;

// 재질별로 밝기(왼쪽 어두움 → 오른쪽 밝음)에 따라 고르는 문자
export const RAMPS = [
  ".,:;+*x%#", // 잎
  "+o%@@", // 오너먼트
  ".o*@", // 전구
  ".:=#%", // 나무 기둥
  ".:=+x#%", // 선물 상자
  ".:;*%#", // 곰인형
  "..-", // 바닥
  ".:=+x#", // 카펫
].map((ramp) => Array.from(ramp, (c) => c.charCodeAt(0)));

export const TILT = 0.22; // 위에서 내려다보는 각도 (rad)
export const AMBIENT = 0.38;
export const SURFACE_DENSITY = 27000; // 물체 표면 1단위 면적당 점 수

export const TREE_POINTS = 52000;
export const CARPET_POINTS = 13000;
export const FLOOR_POINTS = 6000; // 카펫 바깥 고리
export const INNER_FLOOR_POINTS = 9000; // 카펫이 없을 때 그 자리
export const LIGHTS_PER_STRING = 12;
export const BULB_RADIUS = 0.013;
export const BULB_POINTS = 24;

export const RED: Vec3 = [0.8, 0.1, 0.12];
export const GOLD: Vec3 = [0.95, 0.7, 0.18];
export const BLUE: Vec3 = [0.18, 0.32, 0.85];
export const SILVER: Vec3 = [0.8, 0.82, 0.88];
export const GREEN: Vec3 = [0.12, 0.55, 0.3];
export const WHITE: Vec3 = [0.97, 0.97, 1];
export const PALETTE: Record<string, Vec3> = { red: RED, gold: GOLD, blue: BLUE, silver: SILVER, green: GREEN };
export const RIBBON: Record<string, Vec3> = { red: GOLD, gold: RED, blue: SILVER, silver: RED };

export const WARM_BULB: Vec3 = [1, 0.82, 0.42];
export const WHITE_BULB: Vec3 = [1, 0.95, 0.82];
export const MULTI_BULBS: Vec3[] = [
  [1, 0.35, 0.3],
  [0.4, 1, 0.45],
  [0.45, 0.6, 1],
  [1, 0.85, 0.3],
];

export const GIFT_SIZES: Record<string, Vec3> = {
  small: [0.12, 0.09, 0.12],
  medium: [0.16, 0.12, 0.15],
  large: [0.2, 0.15, 0.18],
};


export function normalize([x, y, z]: Vec3): Vec3 {
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

export const mix = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export const LIGHT_DIR = normalize([-0.3, 0.5, 0.8]);
export const HALF_DIR = normalize([LIGHT_DIR[0], LIGHT_DIR[1], LIGHT_DIR[2] + 1]);

// 점 하나 = [x, y, z, nx, ny, nz, r, g, b, ao, phase, material, item]
// phase < 0이면 깜빡이지 않는 전구, item은 아이템 번호(기본 트리는 -1)
export const STRIDE = 13;

export class CloudBuilder {
  private data: number[] = [];
  item = -1;

  constructor(readonly density: number) {}

  add(x: number, y: number, z: number, n: Vec3, [r, g, b]: Vec3, ao: number, mat: number, phase = 0) {
    const [nx, ny, nz] = normalize(n);
    this.data.push(x, y, z, nx, ny, nz, r, g, b, ao, phase, mat, this.item);
  }

  addPlaced(p: Placement, x: number, y: number, z: number, [nx, ny, nz]: Vec3, color: Vec3, ao: number, mat: number) {
    const c = Math.cos(p.yaw);
    const s = Math.sin(p.yaw);
    this.add(p.x + x * c + z * s, y, p.z - x * s + z * c, [nx * c + nz * s, ny, -nx * s + nz * c], color, ao, mat);
  }

  count(n: number) {
    return Math.ceil(n * this.density);
  }

  build() {
    return Float32Array.from(this.data);
  }
}

export const ORIGIN: Placement = { x: 0, z: 0, yaw: 0 };

// color가 함수면 점마다 세로 위치(u: -1 아래 ~ 1 위)로 색을 정한다
export function addEllipsoid(
  b: CloudBuilder,
  rand: () => number,
  place: Placement,
  [cx, cy, cz]: Vec3,
  [rx, ry, rz]: Vec3,
  color: Vec3 | ((u: number) => Vec3),
  mat: number,
) {
  const area = (4 * Math.PI * (rx * ry + ry * rz + rx * rz)) / 3;
  const count = b.count(area * SURFACE_DENSITY);
  for (let i = 0; i < count; i++) {
    const u = rand() * 2 - 1;
    const theta = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const dx = s * Math.cos(theta);
    const dz = s * Math.sin(theta);
    const c = typeof color === "function" ? color(u) : color;
    b.addPlaced(place, cx + dx * rx, cy + u * ry, cz + dz * rz, [dx / rx, u / ry, dz / rz], c, 1, mat);
  }
}

export function addBaseTree(b: CloudBuilder, withInnerFloor: boolean) {
  const rand = mulberry32(1225);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand());

  for (let i = 0, n = b.count(TREE_POINTS); i < n; i++) {
    const t = 1 - Math.sqrt(rand()); // 둘레가 넓은 아래쪽에 점을 더 많이
    const s = Math.pow(rand(), 0.35); // 0 안쪽 → 1 겉면, 대부분 겉면 근처
    const a = rand() * Math.PI * 2;
    const r = foliageRadius(t) * (0.3 + 0.7 * s) * (1 + 0.06 * gauss());
    const normal: Vec3 = [Math.cos(a) + 0.25 * gauss(), 0.5 + 0.25 * gauss(), Math.sin(a) + 0.25 * gauss()];
    const tone = 0.75 + 0.35 * rand();
    let color: Vec3 = rand() < 0.2 ? [0.16 * tone, 0.34 * tone, 0.1 * tone] : [0.07 * tone, 0.3 * tone, 0.13 * tone];
    if (s > 0.8 && normal[1] > 0.6 && rand() < 0.15) color = [0.8, 0.85, 0.9]; // 가지 위에 쌓인 눈
    b.add(Math.cos(a) * r, foliageY(t, r), Math.sin(a) * r, normal, color, 0.35 + 0.65 * Math.pow(s, 1.3), MAT_LEAF);
  }

  const trunkPoints = b.count(2 * Math.PI * TRUNK_RADIUS * TRUNK_HEIGHT * SURFACE_DENSITY);
  for (let i = 0; i < trunkPoints; i++) {
    const a = rand() * Math.PI * 2;
    const y = rand() * TRUNK_HEIGHT;
    // 세로 나무껍질 결
    const bark = 0.7 + 0.2 * Math.sin(a * 14 + 0.4 * gauss()) + 0.15 * rand();
    const color: Vec3 = [0.4 * bark, 0.24 * bark, 0.12 * bark];
    // 가지 바로 아래는 그늘지게
    b.add(Math.cos(a) * TRUNK_RADIUS, y, Math.sin(a) * TRUNK_RADIUS, [Math.cos(a), 0, Math.sin(a)], color, 0.9 - 0.4 * (y / TRUNK_HEIGHT), MAT_WOOD);
  }

  const addFloor = (count: number, inner: number, outer: number) => {
    for (let i = 0, n = b.count(count); i < n; i++) {
      const r = Math.sqrt(inner ** 2 + rand() * (outer ** 2 - inner ** 2));
      const a = rand() * Math.PI * 2;
      const tone = 0.8 + 0.3 * rand();
      b.add(Math.cos(a) * r, 0, Math.sin(a) * r, [0, 1, 0], [0.16 * tone, 0.18 * tone, 0.27 * tone], 1, MAT_FLOOR);
    }
  };
  addFloor(FLOOR_POINTS, CARPET_RADIUS, FLOOR_RADIUS);
  if (withInnerFloor) addFloor(INNER_FLOOR_POINTS, 0, CARPET_RADIUS);
}

export function addOrnament(b: CloudBuilder, rand: () => number, item: TreeItem) {
  const base = PALETTE[item.color] ?? RED;
  const accent = item.color === "gold" || item.color === "silver" ? RED : WHITE;
  const size = 0.03 + rand() * 0.012;
  const color =
    item.variant === "stripe"
      ? (u: number) => (Math.abs(u) < 0.22 ? accent : base)
      : item.variant === "glitter"
        ? () => (rand() < 0.3 ? mix(base, WHITE, 0.55) : base)
        : base;
  addEllipsoid(b, rand, ORIGIN, item.pos, [size, size, size], color, MAT_ORNAMENT);
  // 꼭대기의 금속 고리 캡
  const [x, y, z] = item.pos;
  const cap = item.color === "gold" ? SILVER : GOLD;
  addEllipsoid(b, rand, ORIGIN, [x, y + size * 0.95, z], [size * 0.32, size * 0.2, size * 0.32], cap, MAT_ORNAMENT);
}

// 한 번 고르면 고른 자리를 중심으로 트리를 비스듬히 감싸는 전구 한 줄
export function addLightString(b: CloudBuilder, rand: () => number, item: TreeItem) {
  const [x, y, z] = item.pos;
  const a0 = Math.atan2(z, x);
  const t0 = (y - FOLIAGE_BOTTOM) / (FOLIAGE_TOP - FOLIAGE_BOTTOM);
  const colors = item.color === "multi" ? MULTI_BULBS : [item.color === "white" ? WHITE_BULB : WARM_BULB];
  const steady = item.variant === "steady";
  for (let k = 0; k < LIGHTS_PER_STRING; k++) {
    const s = k - (LIGHTS_PER_STRING - 1) / 2;
    const a = a0 + s * 0.2;
    const t = Math.min(0.93, Math.max(0.02, t0 + s * 0.008 + (rand() - 0.5) * 0.02));
    const r = foliageRadius(t) * 1.1 + 0.01; // 잎 끝보다 살짝 바깥이라 앞쪽 전구는 가려지지 않는다
    const phase = steady ? -1 : rand() * Math.PI * 2;
    const [bx, by, bz] = [Math.cos(a) * r, foliageY(t, r), Math.sin(a) * r];
    // 전구 하나 = 작은 구. 2~3칸을 차지해서 문자 하나보다 잘 보이고, 점들이 같이 깜빡인다
    for (let i = 0; i < BULB_POINTS; i++) {
      const u = rand() * 2 - 1;
      const theta = rand() * Math.PI * 2;
      const s2 = Math.sqrt(1 - u * u);
      const n: Vec3 = [s2 * Math.cos(theta), u, s2 * Math.sin(theta)];
      b.add(bx + n[0] * BULB_RADIUS, by + n[1] * BULB_RADIUS, bz + n[2] * BULB_RADIUS, n, colors[k % colors.length], 1, MAT_LIGHT, phase);
    }
  }
}

export function addGift(b: CloudBuilder, rand: () => number, item: TreeItem) {
  const place: Placement = { x: item.pos[0], z: item.pos[2], yaw: rand() * Math.PI };
  const [w, h, d] = GIFT_SIZES[item.variant] ?? GIFT_SIZES.medium;
  const box = PALETTE[item.color] ?? RED;
  const ribbon = RIBBON[item.color] ?? GOLD;
  const band = 0.018;
  const sample = (area: number, point: () => Vec3, normal: Vec3) => {
    const count = b.count(area * SURFACE_DENSITY);
    for (let i = 0; i < count; i++) {
      const [x, y, z] = point();
      // 윗면은 십자, 옆면은 세로 띠로 리본이 지나간다
      const color = Math.abs(x) < band || Math.abs(z) < band ? ribbon : box;
      b.addPlaced(place, x, y, z, normal, color, 0.6 + 0.4 * (y / h), MAT_GIFT);
    }
  };
  const rx = () => (rand() - 0.5) * w;
  const ry = () => rand() * h;
  const rz = () => (rand() - 0.5) * d;
  sample(w * d, () => [rx(), h, rz()], [0, 1, 0]);
  sample(h * d, () => [w / 2, ry(), rz()], [1, 0, 0]);
  sample(h * d, () => [-w / 2, ry(), rz()], [-1, 0, 0]);
  sample(w * h, () => [rx(), ry(), d / 2], [0, 0, 1]);
  sample(w * h, () => [rx(), ry(), -d / 2], [0, 0, -1]);
  // 리본 매듭
  addEllipsoid(b, rand, place, [-0.024, h + 0.012, 0], [0.026, 0.014, 0.014], ribbon, MAT_GIFT);
  addEllipsoid(b, rand, place, [0.024, h + 0.012, 0], [0.026, 0.014, 0.014], ribbon, MAT_GIFT);
}

// 트리 바깥쪽을 바라보고 앉은 곰인형
export function addTeddy(b: CloudBuilder, rand: () => number, item: TreeItem) {
  const [x, , z] = item.pos;
  const place: Placement = { x, z, yaw: Math.atan2(x, z) };
  const cream = item.color === "cream";
  const furBase: Vec3 = cream ? [0.85, 0.72, 0.52] : [0.55, 0.34, 0.18];
  const light: Vec3 = cream ? [0.9, 0.8, 0.64] : [0.7, 0.5, 0.32]; // 주둥이·배·발바닥 (밝은 데서 하얗게 날아가지 않을 만큼)
  const innerEar: Vec3 = cream ? [0.95, 0.75, 0.7] : [0.75, 0.5, 0.38];
  const bow = item.variant === "green_bow" ? GREEN : RED;
  const bowKnot = mix(bow, [0, 0, 0], 0.25);
  const dark: Vec3 = [0.04, 0.025, 0.02];
  // 털은 점마다 밝기가 조금씩 달라 보송한 결이 생긴다
  const fur = () => {
    const tone = 0.82 + 0.3 * rand();
    return [furBase[0] * tone, furBase[1] * tone, furBase[2] * tone] as Vec3;
  };

  // [중심, 반지름, 색, 재질] — 앞쪽이 +z. 덧붙는 조각(패치·눈·코)은 아래 몸보다 살짝 튀어나와야 보인다
  type Part = [Vec3, Vec3, Vec3 | (() => Vec3), number?];
  const parts: Part[] = [
    [[0, 0.078, 0], [0.072, 0.08, 0.062], fur], // 몸통
    [[0, 0.07, 0.042], [0.045, 0.05, 0.024], light], // 배
    [[0, 0.05, -0.062], [0.016, 0.016, 0.014], fur], // 꼬리
    [[-0.074, 0.098, 0.024], [0.025, 0.048, 0.026], fur], // 팔
    [[0.074, 0.098, 0.024], [0.025, 0.048, 0.026], fur],
    [[-0.04, 0.028, 0.052], [0.032, 0.028, 0.048], fur], // 다리
    [[0.04, 0.028, 0.052], [0.032, 0.028, 0.048], fur],
    [[-0.04, 0.028, 0.098], [0.021, 0.021, 0.006], light], // 발바닥
    [[0.04, 0.028, 0.098], [0.021, 0.021, 0.006], light],
    [[0, 0.192, 0.012], [0.062, 0.058, 0.056], fur], // 머리
    [[-0.046, 0.242, 0], [0.023, 0.023, 0.015], fur], // 귀
    [[0.046, 0.242, 0], [0.023, 0.023, 0.015], fur],
    [[-0.046, 0.241, 0.011], [0.012, 0.012, 0.006], innerEar], // 귀 안쪽
    [[0.046, 0.241, 0.011], [0.012, 0.012, 0.006], innerEar],
    [[0, 0.177, 0.056], [0.029, 0.021, 0.02], light], // 주둥이
    [[0, 0.186, 0.075], [0.011, 0.008, 0.006], dark, MAT_ORNAMENT], // 코 (반짝)
    [[0, 0.169, 0.075], [0.0025, 0.006, 0.003], dark], // 입
    [[-0.023, 0.205, 0.059], [0.009, 0.011, 0.007], dark, MAT_ORNAMENT], // 눈 (반짝)
    [[0.023, 0.205, 0.059], [0.009, 0.011, 0.007], dark, MAT_ORNAMENT],
    [[-0.021, 0.137, 0.056], [0.018, 0.012, 0.008], bow], // 나비넥타이 날개
    [[0.021, 0.137, 0.056], [0.018, 0.012, 0.008], bow],
    [[0, 0.137, 0.061], [0.009, 0.009, 0.007], bowKnot], // 매듭
  ];
  for (const [center, radius, color, mat = MAT_FUR] of parts) {
    addEllipsoid(b, rand, place, center, radius, color, mat);
  }
}

export const CARPET_CREAM: Vec3 = [0.85, 0.78, 0.6];
export const CARPET_RED: Vec3 = [0.62, 0.08, 0.1];
export const CARPET_GREEN: Vec3 = [0.08, 0.36, 0.18];

// 안쪽부터 바탕과 물결 무늬, 크림색 띠, 둘째 색 띠, 테두리, 술. null이면 술 사이 빈틈
export function carpetColor(r: number, a: number, main: Vec3, second: Vec3): Vec3 | null {
  if (r > CARPET_RADIUS) return Math.sin(a * 90) > 0 ? CARPET_CREAM : null;
  if (r > CARPET_RADIUS - 0.035) return CARPET_CREAM;
  if (r > 0.47) return second;
  if (r > 0.43) return CARPET_CREAM;
  if (Math.abs(r - 0.3 - 0.025 * Math.sin(a * 10)) < 0.022) return CARPET_CREAM;
  return main;
}

export function addCarpet(b: CloudBuilder, rand: () => number, item: TreeItem) {
  const [main, second] = item.color === "green" ? [CARPET_GREEN, CARPET_RED] : [CARPET_RED, CARPET_GREEN];
  for (let i = 0, n = b.count(CARPET_POINTS); i < n; i++) {
    const r = (CARPET_RADIUS + 0.035) * Math.sqrt(rand());
    const a = rand() * Math.PI * 2;
    const color = carpetColor(r, a, main, second);
    if (!color) continue;
    const ao = (0.5 + 0.5 * Math.min(1, r / 0.5)) * (0.8 + 0.2 * rand());
    b.add(Math.cos(a) * r, 0.004, Math.sin(a) * r, [0, 1, 0], color, ao, MAT_CARPET);
  }
}

export type Scene = {
  cloud: Float32Array;
  star: { index: number; color: Vec3 } | null; // 꼭대기 별은 점이 아니라 화면 위에 따로 그린다
  snow: boolean;
};

export function buildScene(items: TreeItem[], density: number): Scene {
  const b = new CloudBuilder(density);
  addBaseTree(b, !items.some((item) => item.itemType === "carpet"));

  let star: Scene["star"] = null;
  let snow = false;
  items.forEach((item, index) => {
    const [x, y, z] = item.pos;
    const rand = mulberry32((index + 1) * 7919 + Math.round(x * 1e4) * 31 + Math.round(y * 1e4) * 17 + Math.round(z * 1e4));
    b.item = index;
    switch (item.itemType) {
      case "ornament":
        addOrnament(b, rand, item);
        break;
      case "light":
        addLightString(b, rand, item);
        break;
      case "gift":
        addGift(b, rand, item);
        break;
      case "teddy":
        addTeddy(b, rand, item);
        break;
      case "carpet":
        addCarpet(b, rand, item);
        break;
      case "star":
        star = { index, color: STAR_COLORS[item.color] ?? STAR_COLORS.gold };
        break;
      case "snow":
        snow = true;
        break;
    }
    b.item = -1;
  });

  return { cloud: b.build(), star, snow };
}


// 투영된 점 하나의 문자 코드와 색. 뜨거운 루프에서 객체를 만들지 않도록 결과를 SHADE에 담는다.
// 전구는 time에 따라 깜빡이고, 나머지는 회전된 법선과 조명으로 명암을 낸다.
export const SHADE = { code: 0, r: 0, g: 0, b: 0 };

export function shadePoint(
  cloud: Float32Array,
  i: number,
  cosR: number,
  sinR: number,
  cosT: number,
  sinT: number,
  time: number,
) {
  const mat = cloud[i + 11];
  let shade: number;
  let brightness: number;
  let spec = 0;
  if (mat === MAT_LIGHT) {
    const phase = cloud[i + 10];
    shade = phase < 0 ? 0.85 : 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(time * 0.004 + phase));
    brightness = 0.55 + 0.75 * shade;
  } else {
    const nx = cloud[i + 3];
    const nz = cloud[i + 5];
    const nx1 = nx * cosR - nz * sinR;
    const nz1 = nx * sinR + nz * cosR;
    const ny2 = cloud[i + 4] * cosT - nz1 * sinT;
    const nz2 = cloud[i + 4] * sinT + nz1 * cosT;
    const diffuse = Math.max(0, nx1 * LIGHT_DIR[0] + ny2 * LIGHT_DIR[1] + nz2 * LIGHT_DIR[2]);
    if (mat === MAT_ORNAMENT) {
      shade = 0.25 + 0.75 * diffuse;
      spec = Math.pow(Math.max(0, nx1 * HALF_DIR[0] + ny2 * HALF_DIR[1] + nz2 * HALF_DIR[2]), 24);
      brightness = 0.45 + 1.2 * shade;
    } else {
      shade = cloud[i + 9] * (AMBIENT + (1 - AMBIENT) * diffuse);
      brightness = 0.45 + 1.5 * shade;
    }
  }
  const ramp = RAMPS[mat];
  SHADE.code = ramp[Math.min(ramp.length - 1, Math.floor(Math.min(1, shade + spec) * ramp.length))];
  SHADE.r = cloud[i + 6] * brightness + spec;
  SHADE.g = cloud[i + 7] * brightness + spec;
  SHADE.b = cloud[i + 8] * brightness + spec;
}

export const STAR_COLORS: Record<string, Vec3> = { gold: [1, 0.8, 0.35], silver: [0.85, 0.9, 1] };

// 미리보기용 입체 별: 다섯 꼭짓점 별 모양을 앞뒤 면과 옆면으로 두께 있게 만든다
function addStar3D(b: CloudBuilder, rand: () => number, color: Vec3) {
  const outer = 0.07;
  const inner = 0.03;
  const depth = 0.012;
  const corners = Array.from({ length: 10 }, (_, k) => {
    const a = Math.PI / 2 + (k * Math.PI) / 5;
    const r = k % 2 === 0 ? outer : inner;
    return [Math.cos(a) * r, Math.sin(a) * r] as const;
  });
  // 별 = 중심에서 뻗은 삼각형 10개
  for (let k = 0; k < 10; k++) {
    const [x1, y1] = corners[k];
    const [x2, y2] = corners[(k + 1) % 10];
    const area = Math.abs(x1 * y2 - x2 * y1) / 2;
    for (let i = 0, n = b.count(area * SURFACE_DENSITY * 2); i < n; i++) {
      let u = rand();
      let v = rand();
      if (u + v > 1) {
        u = 1 - u;
        v = 1 - v;
      }
      const x = x1 * u + x2 * v;
      const y = y1 * u + y2 * v;
      // 가운데가 볼록하게 법선을 살짝 바깥으로 기울인다
      const bulge = 1 - (u + v);
      b.add(x, y, depth, [x * 6, y * 6, 1 + bulge], color, 1, MAT_ORNAMENT);
      b.add(x, y, -depth, [x * 6, y * 6, -1 - bulge], color, 1, MAT_ORNAMENT);
    }
    // 옆면
    const edge = Math.hypot(x2 - x1, y2 - y1);
    for (let i = 0, n = b.count(edge * depth * 2 * SURFACE_DENSITY * 2); i < n; i++) {
      const t = rand();
      const x = x1 + (x2 - x1) * t;
      const y = y1 + (y2 - y1) * t;
      b.add(x, y, (rand() * 2 - 1) * depth, [y2 - y1, -(x2 - x1), 0], color, 0.9, MAT_ORNAMENT);
    }
  }
}

// 미리보기용 전구 줄: 살짝 처진 전선에 전구 다섯 알이 매달려 있다
function addGarland(b: CloudBuilder, rand: () => number, item: TreeItem) {
  const colors = item.color === "multi" ? MULTI_BULBS : [item.color === "white" ? WHITE_BULB : WARM_BULB];
  const steady = item.variant === "steady";
  const span = 0.24;
  const sag = (x: number) => -0.035 * (1 - (x / (span / 2)) ** 2);
  const wire: Vec3 = [0.1, 0.22, 0.12];
  for (let i = 0, n = b.count(span * 0.006 * SURFACE_DENSITY * 30); i < n; i++) {
    const x = (rand() - 0.5) * span;
    const a = rand() * Math.PI * 2;
    b.add(x, sag(x) + Math.sin(a) * 0.003, Math.cos(a) * 0.003, [0, Math.sin(a), Math.cos(a)], wire, 0.8, MAT_WOOD);
  }
  const count = 5;
  for (let k = 0; k < count; k++) {
    const x = (k / (count - 1) - 0.5) * span * 0.9;
    const top = sag(x);
    // 소켓
    addEllipsoid(b, rand, ORIGIN, [x, top - 0.008, 0], [0.007, 0.008, 0.007], wire, MAT_WOOD);
    // 아래로 볼록한 전구. 점마다 같은 phase라 한 알이 함께 깜빡인다
    const phase = steady ? -1 : rand() * Math.PI * 2;
    const [rx, ry, rz] = [0.012, 0.02, 0.012];
    const cy = top - 0.016 - ry;
    for (let i = 0, n = b.count(4 * Math.PI * 0.0003 * SURFACE_DENSITY * 2); i < n; i++) {
      const u = rand() * 2 - 1;
      const theta = rand() * Math.PI * 2;
      const s2 = Math.sqrt(1 - u * u);
      const n3: Vec3 = [s2 * Math.cos(theta), u, s2 * Math.sin(theta)];
      b.add(x + n3[0] * rx, cy + n3[1] * ry, n3[2] * rz, n3, colors[k % colors.length], 1, MAT_LIGHT, phase);
    }
  }
}

export type ItemPreview = { cloud: Float32Array; radius: number };

// 아이템 하나만 원점에 모아 만든 점 구름과 그것을 감싸는 반지름. 눈 내리기는 점이 없다.
export function buildItemPreview(item: TreeItem, density: number): ItemPreview {
  const b = new CloudBuilder(density);
  const [x, y, z] = item.pos;
  const rand = mulberry32(Math.round(x * 1e4) * 31 + Math.round(y * 1e4) * 17 + Math.round(z * 1e4) + 7919);
  const atOrigin: TreeItem = { ...item, pos: [0, 0, 0] };
  switch (item.itemType) {
    case "ornament":
      addOrnament(b, rand, atOrigin);
      break;
    case "light":
      addGarland(b, rand, item);
      break;
    case "gift":
      addGift(b, rand, atOrigin);
      break;
    case "teddy":
      addTeddy(b, rand, atOrigin);
      break;
    case "carpet":
      addCarpet(b, rand, atOrigin);
      break;
    case "star":
      addStar3D(b, rand, STAR_COLORS[item.color] ?? STAR_COLORS.gold);
      break;
    case "snow":
      break;
  }
  const cloud = b.build();
  if (cloud.length === 0) return { cloud, radius: 1 };

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < cloud.length; i += STRIDE) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], cloud[i + k]);
      max[k] = Math.max(max[k], cloud[i + k]);
    }
  }
  const center = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
  let radius = 0;
  for (let i = 0; i < cloud.length; i += STRIDE) {
    for (let k = 0; k < 3; k++) cloud[i + k] -= center[k];
    radius = Math.max(radius, Math.hypot(cloud[i], cloud[i + 1], cloud[i + 2]));
  }
  return { cloud, radius };
}
