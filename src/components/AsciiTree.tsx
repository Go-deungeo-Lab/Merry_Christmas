"use client";

import { useEffect, useRef } from "react";
import type { ItemType } from "@/db/schema";
import { mulberry32 } from "@/lib/random";
import {
  CARPET_RADIUS,
  FLOOR_RADIUS,
  FOLIAGE_BOTTOM,
  FOLIAGE_TOP,
  STAR_Y,
  TRUNK_HEIGHT,
  TRUNK_RADIUS,
  foliageRadius,
  foliageY,
} from "@/lib/tree-geometry";

// 화면을 문자 칸 격자로 나누고, 3D 점 구름을 투영해 칸마다 가장 앞에 있는 점의 밝기로 문자를 고른다.
//
// 레이어
// 1. 기본 트리: 잎·눈 쌓인 가지·기둥·바닥. 모두에게 같다.
// 2. 아이템: items 데이터대로 그린다. 3D 점이라 트리와 함께 돌고 뒤로 가면 가려진다.
// 3. 오늘의 불빛: showTodayLight일 때만.
//
// 점 투영은 회전·크기·아이템이 바뀔 때만 다시 하고(정적 캔버스에 캐시),
// 매 프레임에는 반짝이는 것(전구·별·불빛·배경 별·눈)만 그 위에 그린다.

export type TreeItem = {
  itemType: ItemType;
  color: string;
  variant: string;
  pos: [number, number, number];
};

type Vec3 = [number, number, number];
type Placement = { x: number; z: number; yaw: number };

const MAT_LEAF = 0;
const MAT_ORNAMENT = 1;
const MAT_LIGHT = 2;
const MAT_WOOD = 3;
const MAT_GIFT = 4;
const MAT_FUR = 5;
const MAT_FLOOR = 6;
const MAT_CARPET = 7;

// 재질별로 밝기(왼쪽 어두움 → 오른쪽 밝음)에 따라 고르는 문자
const RAMPS = [
  ".,:;+*x%#", // 잎
  "+o%@@", // 오너먼트
  ".o*@", // 전구
  ".:=#%", // 나무 기둥
  ".:=+x#%", // 선물 상자
  ".:;*%#", // 곰인형
  "..-", // 바닥
  ".:=+x#", // 카펫
].map((ramp) => Array.from(ramp, (c) => c.charCodeAt(0)));

const BASE_ROWS_PER_UNIT = 84; // 넓은 화면에서 트리 높이 1당 문자 줄 수
const MIN_FONT = 6; // 좁은 화면에서는 줄 수(와 점 개수)를 줄여 이 크기 아래로 내려가지 않게
const TILT = 0.22; // 위에서 내려다보는 각도 (rad)
const CAMERA_DISTANCE = 5;
const INITIAL_ROTATION = 0.5;
const DRAG_SPEED = 0.01; // rad/px
const DRAG_THRESHOLD = 5; // 이보다 적게 움직이면 클릭
const HIT_RADIUS = 22; // 클릭 영역 반지름 (지름 44px)
const FRAME_INTERVAL = 1000 / 30;
const AMBIENT = 0.38;
const SURFACE_DENSITY = 27000; // 물체 표면 1단위 면적당 점 수

const TREE_POINTS = 52000;
const CARPET_POINTS = 13000;
const FLOOR_POINTS = 6000; // 카펫 바깥 고리
const INNER_FLOOR_POINTS = 9000; // 카펫이 없을 때 그 자리
const LIGHTS_PER_STRING = 12;
const BULB_RADIUS = 0.013;
const BULB_POINTS = 24;
const TODAY_LIGHT_Y = 1.0; // 별 바로 아래, 회전축 위라 항상 같은 자리
const BG_STAR_COUNT = 220;
const SNOW_COUNT = 120;

const RED: Vec3 = [0.8, 0.1, 0.12];
const GOLD: Vec3 = [0.95, 0.7, 0.18];
const BLUE: Vec3 = [0.18, 0.32, 0.85];
const SILVER: Vec3 = [0.8, 0.82, 0.88];
const GREEN: Vec3 = [0.12, 0.55, 0.3];
const WHITE: Vec3 = [0.97, 0.97, 1];
const PALETTE: Record<string, Vec3> = { red: RED, gold: GOLD, blue: BLUE, silver: SILVER, green: GREEN };
const RIBBON: Record<string, Vec3> = { red: GOLD, gold: RED, blue: SILVER, silver: RED };

const WARM_BULB: Vec3 = [1, 0.82, 0.42];
const WHITE_BULB: Vec3 = [1, 0.95, 0.82];
const MULTI_BULBS: Vec3[] = [
  [1, 0.35, 0.3],
  [0.4, 1, 0.45],
  [0.45, 0.6, 1],
  [1, 0.85, 0.3],
];

const GIFT_SIZES: Record<string, Vec3> = {
  small: [0.12, 0.09, 0.12],
  medium: [0.16, 0.12, 0.15],
  large: [0.2, 0.15, 0.18],
};

// 꼭대기 별의 빛줄기: [dx, dy, 길이, 문자 코드]
const STAR_RAYS: [number, number, number, number][] = (
  [
    [0, -1, 8, "|"],
    [1, -1, 6, "/"],
    [-1, -1, 6, "\\"],
    [1, 0, 6, "-"],
    [-1, 0, 6, "-"],
    [1, 1, 3, "\\"],
    [-1, 1, 3, "/"],
  ] as const
).map(([dx, dy, length, ch]) => [dx, dy, length, ch.charCodeAt(0)]);

function normalize([x, y, z]: Vec3): Vec3 {
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

const mix = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const LIGHT_DIR = normalize([-0.3, 0.5, 0.8]);
const HALF_DIR = normalize([LIGHT_DIR[0], LIGHT_DIR[1], LIGHT_DIR[2] + 1]);

// 점 하나 = [x, y, z, nx, ny, nz, r, g, b, ao, phase, material, item]
// phase < 0이면 깜빡이지 않는 전구, item은 아이템 번호(기본 트리는 -1)
const STRIDE = 13;

class CloudBuilder {
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

const ORIGIN: Placement = { x: 0, z: 0, yaw: 0 };

// color가 함수면 점마다 세로 위치(u: -1 아래 ~ 1 위)로 색을 정한다
function addEllipsoid(
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

function addBaseTree(b: CloudBuilder, withInnerFloor: boolean) {
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

function addOrnament(b: CloudBuilder, rand: () => number, item: TreeItem) {
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
}

// 한 번 고르면 고른 자리를 중심으로 트리를 비스듬히 감싸는 전구 한 줄
function addLightString(b: CloudBuilder, rand: () => number, item: TreeItem) {
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

function addGift(b: CloudBuilder, rand: () => number, item: TreeItem) {
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
function addTeddy(b: CloudBuilder, rand: () => number, item: TreeItem) {
  const [x, , z] = item.pos;
  const place: Placement = { x, z, yaw: Math.atan2(x, z) };
  const fur: Vec3 = item.color === "cream" ? [0.85, 0.72, 0.52] : [0.55, 0.34, 0.18];
  const muzzle: Vec3 = item.color === "cream" ? [0.95, 0.88, 0.75] : [0.8, 0.62, 0.42];
  const bow = item.variant === "green_bow" ? GREEN : RED;
  const dark: Vec3 = [0.05, 0.03, 0.02];
  // [중심, 반지름, 색] — 앞쪽이 +z
  const parts: [Vec3, Vec3, Vec3][] = [
    [[0, 0.075, 0], [0.07, 0.08, 0.06], fur], // 몸통
    [[0, 0.18, 0.01], [0.055, 0.055, 0.055], fur], // 머리
    [[-0.042, 0.225, 0], [0.02, 0.02, 0.014], fur], // 귀
    [[0.042, 0.225, 0], [0.02, 0.02, 0.014], fur],
    [[0, 0.17, 0.05], [0.026, 0.02, 0.018], muzzle], // 주둥이
    [[-0.075, 0.09, 0.02], [0.024, 0.045, 0.024], fur], // 팔
    [[0.075, 0.09, 0.02], [0.024, 0.045, 0.024], fur],
    [[-0.04, 0.025, 0.05], [0.03, 0.025, 0.04], fur], // 다리
    [[0.04, 0.025, 0.05], [0.03, 0.025, 0.04], fur],
    [[-0.02, 0.19, 0.058], [0.01, 0.01, 0.01], dark], // 눈
    [[0.02, 0.19, 0.058], [0.01, 0.01, 0.01], dark],
    [[0, 0.176, 0.066], [0.009, 0.008, 0.008], dark], // 코
    [[0, 0.128, 0.055], [0.03, 0.012, 0.012], bow], // 나비넥타이
  ];
  for (const [center, radius, color] of parts) {
    addEllipsoid(b, rand, place, center, radius, color, MAT_FUR);
  }
}

const CARPET_CREAM: Vec3 = [0.85, 0.78, 0.6];
const CARPET_RED: Vec3 = [0.62, 0.08, 0.1];
const CARPET_GREEN: Vec3 = [0.08, 0.36, 0.18];

// 안쪽부터 바탕과 물결 무늬, 크림색 띠, 둘째 색 띠, 테두리, 술. null이면 술 사이 빈틈
function carpetColor(r: number, a: number, main: Vec3, second: Vec3): Vec3 | null {
  if (r > CARPET_RADIUS) return Math.sin(a * 90) > 0 ? CARPET_CREAM : null;
  if (r > CARPET_RADIUS - 0.035) return CARPET_CREAM;
  if (r > 0.47) return second;
  if (r > 0.43) return CARPET_CREAM;
  if (Math.abs(r - 0.3 - 0.025 * Math.sin(a * 10)) < 0.022) return CARPET_CREAM;
  return main;
}

function addCarpet(b: CloudBuilder, rand: () => number, item: TreeItem) {
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

type Scene = {
  cloud: Float32Array;
  star: { index: number; color: Vec3 } | null; // 꼭대기 별은 점이 아니라 화면 위에 따로 그린다
  snow: boolean;
};

function buildScene(items: TreeItem[], density: number): Scene {
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
        star = { index, color: item.color === "silver" ? [0.85, 0.9, 1] : [1, 0.8, 0.35] };
        break;
      case "snow":
        snow = true;
        break;
    }
    b.item = -1;
  });

  return { cloud: b.build(), star, snow };
}

type Props = {
  items: TreeItem[];
  showTodayLight?: boolean;
  onTodayLightClick?: () => void;
  onItemClick?: (index: number) => void;
  className?: string;
};

type Renderer = {
  setItems: (items: TreeItem[]) => void;
  setShowTodayLight: (show: boolean) => void;
};

export default function AsciiTree({ items, showTodayLight = false, onTodayLightClick, onItemClick, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const propsRef = useRef({ items, showTodayLight, onTodayLightClick, onItemClick });

  useEffect(() => {
    propsRef.current = { items, showTodayLight, onTodayLightClick, onItemClick };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const staticCanvas = document.createElement("canvas");
    const sctx = staticCanvas.getContext("2d");
    if (!canvas || !ctx || !sctx) return;

    let items = propsRef.current.items;
    let showLight = propsRef.current.showTodayLight;
    let scene: Scene | null = null;
    let density = 0;
    let needsBuild = true;
    let needsProject = true;

    rendererRef.current = {
      setItems(next) {
        if (next === items) return;
        items = next;
        needsBuild = true;
      },
      setShowTodayLight(show) {
        if (show === showLight) return;
        showLight = show;
        needsProject = true;
      },
    };

    const bgStars = Array.from({ length: BG_STAR_COUNT }, () => ({
      x: Math.random(),
      y: Math.random() * 0.8,
      phase: Math.random() * Math.PI * 2,
      code: (Math.random() < 0.85 ? "." : "+").charCodeAt(0),
    }));
    const snowflakes = Array.from({ length: SNOW_COUNT }, () => ({
      x: Math.random(),
      y: Math.random(),
      speed: 0.02 + Math.random() * 0.04,
      phase: Math.random() * Math.PI * 2,
      code: (Math.random() < 0.7 ? "." : "*").charCodeAt(0),
    }));

    const fontFamily =
      getComputedStyle(document.body).getPropertyValue("--font-geist-mono").trim() || "monospace";
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const charStrings = Array.from({ length: 128 }, (_, code) => String.fromCharCode(code));
    const styleCache: string[] = [];
    const styleOf = (key: number) =>
      (styleCache[key] ??= `rgb(${((key >> 10) & 31) * 8.226}, ${((key >> 5) & 31) * 8.226}, ${(key & 31) * 8.226})`);
    const quantize = (r: number, g: number, b: number) =>
      (Math.round(Math.min(1, r) * 31) << 10) | (Math.round(Math.min(1, g) * 31) << 5) | Math.round(Math.min(1, b) * 31);

    let width = 0;
    let height = 0;
    let unit = 0;
    let fontSize = 0;
    let font = "";
    let cellW = 1;
    let cellH = 1;
    let cols = 0;
    let rows = 0;
    let capacity = 0;
    let depth = new Float32Array(0);
    let cellChar = new Uint8Array(0);
    let cellKey = new Uint16Array(0);
    let cellPoint = new Int32Array(0); // 이긴 점의 위치, -1 빈칸, -2 화면 위에 따로 그리는 칸
    let cellItem = new Int16Array(0); // 클릭 판정용 아이템 번호
    let next = new Int32Array(0);
    const head = new Int32Array(1 << 15).fill(-1);
    const usedKeys: number[] = [];
    const lightCells: number[] = [];
    let starCell: [number, number] | null = null;
    let todayLight: { col: number; row: number; x: number; y: number } | null = null;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = staticCanvas.width = Math.round(width * dpr);
      canvas.height = staticCanvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // 별~바닥 앞쪽까지 약 1.55 단위, 선물까지 가로 약 1.3 단위가 들어오도록
      unit = Math.min((height * 0.84) / 1.55, (width * 0.94) / 1.3);
      fontSize = Math.max(MIN_FONT, unit / BASE_ROWS_PER_UNIT);
      font = `${fontSize}px ${fontFamily}`;
      cellH = fontSize;
      rows = Math.ceil(height / cellH);
      // 칸이 줄어든 만큼 점도 줄인다 (0.1 단위로 끊어서 크기를 조금 바꿀 때마다 다시 만들지 않게)
      const ratio = unit / fontSize / BASE_ROWS_PER_UNIT;
      const nextDensity = Math.max(0.1, Math.min(1, Math.round(ratio * ratio * 10) / 10));
      if (nextDensity !== density) {
        density = nextDensity;
        needsBuild = true;
      }
      // 글꼴이 늦게 로드돼 글자 폭이 바뀌어도 넘치지 않게 넉넉히
      capacity = Math.ceil(width / (fontSize * 0.5)) * rows;
      depth = new Float32Array(capacity);
      cellChar = new Uint8Array(capacity);
      cellKey = new Uint16Array(capacity);
      cellPoint = new Int32Array(capacity);
      cellItem = new Int16Array(capacity);
      next = new Int32Array(capacity);
      needsProject = true;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let rotation = INITIAL_ROTATION;
    const cosT = Math.cos(TILT);
    const sinT = Math.sin(TILT);

    const project = (current: Scene) => {
      const { cloud } = current;
      ctx.font = font;
      ctx.textBaseline = "top";
      sctx.font = font;
      sctx.textBaseline = "top";
      cellW = ctx.measureText("M").width;
      cols = Math.min(Math.ceil(width / cellW), Math.floor(capacity / rows));
      const cellCount = cols * rows;
      const cx = width / 2;
      const baseY = (height * 0.86 - 1.55 * unit) / 2 + 1.3 * unit; // 바닥 중심의 화면 y
      depth.fill(-Infinity, 0, cellCount);
      cellPoint.fill(-1, 0, cellCount);
      cellItem.fill(-1, 0, cellCount);

      const cosR = Math.cos(rotation);
      const sinR = Math.sin(rotation);
      for (let i = 0; i < cloud.length; i += STRIDE) {
        const x = cloud[i];
        const y = cloud[i + 1];
        const z = cloud[i + 2];
        const x1 = x * cosR - z * sinR;
        const z1 = x * sinR + z * cosR;
        const y2 = y * cosT - z1 * sinT;
        const z2 = y * sinT + z1 * cosT; // +가 보는 사람 쪽
        const persp = CAMERA_DISTANCE / (CAMERA_DISTANCE - z2);
        const col = Math.floor((cx + x1 * unit * persp) / cellW);
        const row = Math.floor((baseY - y2 * unit * persp) / cellH);
        if (col < 0 || col >= cols || row < 0 || row >= rows) continue;
        const cell = row * cols + col;
        if (z2 <= depth[cell]) continue;

        depth[cell] = z2;
        cellPoint[cell] = i;
        cellItem[cell] = cloud[i + 12];
        const mat = cloud[i + 11];
        if (mat === MAT_LIGHT) continue; // 전구는 매 프레임 따로 그린다

        const nx = cloud[i + 3];
        const nz = cloud[i + 5];
        const nx1 = nx * cosR - nz * sinR;
        const nz1 = nx * sinR + nz * cosR;
        const ny2 = cloud[i + 4] * cosT - nz1 * sinT;
        const nz2 = cloud[i + 4] * sinT + nz1 * cosT;
        const diffuse = Math.max(0, nx1 * LIGHT_DIR[0] + ny2 * LIGHT_DIR[1] + nz2 * LIGHT_DIR[2]);

        let shade: number;
        let brightness: number;
        let spec = 0;
        if (mat === MAT_ORNAMENT) {
          shade = 0.25 + 0.75 * diffuse;
          spec = Math.pow(Math.max(0, nx1 * HALF_DIR[0] + ny2 * HALF_DIR[1] + nz2 * HALF_DIR[2]), 24);
          brightness = 0.45 + 1.2 * shade;
        } else {
          shade = cloud[i + 9] * (AMBIENT + (1 - AMBIENT) * diffuse);
          brightness = 0.45 + 1.5 * shade;
        }

        const ramp = RAMPS[mat];
        cellChar[cell] = ramp[Math.min(ramp.length - 1, Math.floor(Math.min(1, shade + spec) * ramp.length))];
        cellKey[cell] = quantize(
          cloud[i + 6] * brightness + spec,
          cloud[i + 7] * brightness + spec,
          cloud[i + 8] * brightness + spec,
        );
      }

      // 화면 위에 따로 그리는 칸(별·오늘의 불빛)은 비워 두고 클릭 판정만 남긴다
      const reserve = (col: number, row: number, item: number) => {
        if (col < 0 || col >= cols || row < 0 || row >= rows) return;
        const cell = row * cols + col;
        depth[cell] = Infinity;
        cellPoint[cell] = -2;
        cellItem[cell] = item;
      };
      const axisCell = (y: number): [number, number] => {
        const persp = CAMERA_DISTANCE / (CAMERA_DISTANCE - y * sinT);
        return [Math.floor(cx / cellW), Math.floor((baseY - y * cosT * unit * persp) / cellH)];
      };

      starCell = null;
      if (current.star) {
        const [sc, sr] = axisCell(STAR_Y);
        starCell = [sc, sr];
        for (const [dx, dy, length] of STAR_RAYS) {
          for (let k = 0; k <= length; k++) reserve(sc + dx * k, sr + dy * k, current.star.index);
        }
      }

      todayLight = null;
      if (showLight) {
        const [col, row] = axisCell(TODAY_LIGHT_Y);
        for (const dx of [-1, 0, 1]) reserve(col + dx, row, -1);
        todayLight = { col, row, x: (col + 0.5) * cellW, y: (row + 0.5) * cellH };
      }

      // 움직이지 않는 칸은 정적 캔버스에 한 번만, 같은 색끼리 묶어서 그린다
      sctx.clearRect(0, 0, width, height);
      usedKeys.length = 0;
      lightCells.length = 0;
      for (let cell = 0; cell < cellCount; cell++) {
        const p = cellPoint[cell];
        if (p < 0) continue;
        if (cloud[p + 11] === MAT_LIGHT) {
          lightCells.push(cell);
          continue;
        }
        const key = cellKey[cell];
        if (head[key] === -1) usedKeys.push(key);
        next[cell] = head[key];
        head[key] = cell;
      }
      for (const key of usedKeys) {
        sctx.fillStyle = styleOf(key);
        for (let cell = head[key]; cell !== -1; cell = next[cell]) {
          sctx.fillText(charStrings[cellChar[cell]], (cell % cols) * cellW, Math.floor(cell / cols) * cellH);
        }
        head[key] = -1;
      }
    };

    const drawChar = (col: number, row: number, code: number, r: number, g: number, b: number, glow = false) => {
      if (col < 0 || col >= cols || row < 0 || row >= rows) return;
      const style = styleOf(quantize(r, g, b));
      ctx.fillStyle = style;
      if (glow) ctx.shadowColor = style;
      ctx.fillText(charStrings[code], col * cellW, row * cellH);
    };

    // 클릭 지점 근처(반지름 22px)에서 화면에 보이는 칸 중 가장 가까운 대상
    const hitTest = (px: number, py: number): { type: "light" } | { type: "item"; index: number } | null => {
      if (todayLight && Math.hypot(px - todayLight.x, py - todayLight.y) <= Math.max(HIT_RADIUS, cellH * 2)) {
        return { type: "light" };
      }
      let best = -1;
      let bestDist = HIT_RADIUS;
      const c0 = Math.max(0, Math.floor((px - HIT_RADIUS) / cellW));
      const c1 = Math.min(cols - 1, Math.floor((px + HIT_RADIUS) / cellW));
      const r0 = Math.max(0, Math.floor((py - HIT_RADIUS) / cellH));
      const r1 = Math.min(rows - 1, Math.floor((py + HIT_RADIUS) / cellH));
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const item = cellItem[row * cols + col];
          if (item < 0) continue;
          const d = Math.hypot((col + 0.5) * cellW - px, (row + 0.5) * cellH - py);
          if (d <= bestDist) {
            best = item;
            bestDist = d;
          }
        }
      }
      return best >= 0 ? { type: "item", index: best } : null;
    };

    let pointer: { id: number; startX: number; startY: number; lastX: number; dragging: boolean } | null = null;
    const localPoint = (e: PointerEvent): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      return [e.clientX - rect.left, e.clientY - rect.top];
    };
    const onPointerDown = (e: PointerEvent) => {
      pointer = { id: e.pointerId, startX: e.clientX, startY: e.clientY, lastX: e.clientX, dragging: false };
    };
    const onPointerMove = (e: PointerEvent) => {
      if (pointer && e.pointerId === pointer.id) {
        if (!pointer.dragging && Math.hypot(e.clientX - pointer.startX, e.clientY - pointer.startY) >= DRAG_THRESHOLD) {
          pointer.dragging = true;
          canvas.setPointerCapture(e.pointerId);
        }
        if (pointer.dragging) {
          rotation += (e.clientX - pointer.lastX) * DRAG_SPEED;
          pointer.lastX = e.clientX;
          needsProject = true;
        }
        return;
      }
      if (e.pointerType === "mouse") {
        const [px, py] = localPoint(e);
        canvas.style.cursor = hitTest(px, py) ? "pointer" : "";
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!pointer || e.pointerId !== pointer.id) return;
      const wasDrag = pointer.dragging;
      pointer = null;
      if (wasDrag) return;
      const [px, py] = localPoint(e);
      const hit = hitTest(px, py);
      if (hit?.type === "light") propsRef.current.onTodayLightClick?.();
      else if (hit?.type === "item") propsRef.current.onItemClick?.(hit.index);
    };
    const onPointerCancel = () => {
      pointer = null;
    };
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);

    let frame = 0;
    let lastDraw = performance.now();
    const draw = (time: number) => {
      frame = requestAnimationFrame(draw);
      if (time - lastDraw < FRAME_INTERVAL - 1) return;
      const dt = Math.min((time - lastDraw) / 1000, 0.1);
      lastDraw = time;

      if (needsBuild || !scene) {
        scene = buildScene(items, density);
        needsBuild = false;
        needsProject = true;
      }
      if (needsProject) {
        project(scene);
        needsProject = false;
      }
      const { cloud, star } = scene;

      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(staticCanvas, 0, 0, width, height);

      for (const s of bgStars) {
        const col = Math.floor(s.x * cols);
        const row = Math.floor(s.y * rows);
        if (depth[row * cols + col] !== -Infinity) continue;
        const tw = 0.25 + 0.2 * Math.sin(time * 0.002 + s.phase);
        drawChar(col, row, s.code, tw, tw * 1.05, tw * 1.3);
      }

      // 여기부터 빛 번짐
      ctx.shadowBlur = cellH * 1.5;

      const lightRamp = RAMPS[MAT_LIGHT];
      for (const cell of lightCells) {
        const p = cellPoint[cell];
        const phase = cloud[p + 10];
        const shade = phase < 0 ? 0.85 : 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(time * 0.004 + phase));
        const brightness = 0.55 + 0.75 * shade;
        const code = lightRamp[Math.min(lightRamp.length - 1, Math.floor(shade * lightRamp.length))];
        drawChar(cell % cols, Math.floor(cell / cols), code, cloud[p + 6] * brightness, cloud[p + 7] * brightness, cloud[p + 8] * brightness, true);
      }

      if (star && starCell) {
        const [sc, sr] = starCell;
        const pulse = 0.75 + 0.25 * Math.sin(time * 0.003);
        const [r, g, b] = star.color;
        for (const [dx, dy, length, ch] of STAR_RAYS) {
          for (let k = 1; k <= length; k++) {
            const fade = (1 - k / (length + 1)) * pulse;
            drawChar(sc + dx * k, sr + dy * k, ch, r * fade, g * fade, b * fade, true);
          }
        }
        drawChar(sc, sr, 64, Math.min(1, r + 0.1), Math.min(1, g + 0.15), Math.min(1, b + 0.2), true);
      }

      const lightPulse = 0.5 + 0.5 * Math.sin(time * 0.004);
      if (todayLight) {
        const { col, row } = todayLight;
        drawChar(col, row, 64, 1, 0.97, 0.85, true);
        drawChar(col - 1, row, 111, 1, 0.9, 0.6 + 0.3 * lightPulse, true);
        drawChar(col + 1, row, 111, 1, 0.9, 0.6 + 0.3 * lightPulse, true);
      }

      ctx.shadowBlur = 0;

      if (todayLight) {
        const { x, y } = todayLight;
        const glowRadius = unit * 0.07 * (1 + lightPulse * 0.4);
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
        gradient.addColorStop(0, `rgba(255, 240, 190, ${0.35 + lightPulse * 0.25})`);
        gradient.addColorStop(1, "rgba(255, 240, 190, 0)");
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = gradient;
        ctx.fillRect(x - glowRadius, y - glowRadius, glowRadius * 2, glowRadius * 2);
        ctx.globalCompositeOperation = "source-over";
      }

      if (scene.snow) {
        for (const s of snowflakes) {
          if (!reduceMotion) {
            s.y += s.speed * dt;
            s.x += Math.sin(time * 0.001 + s.phase) * 0.004 * dt;
            if (s.y > 1) {
              s.y = 0;
              s.x = Math.random();
            }
          }
          drawChar(Math.floor(s.x * cols), Math.floor(s.y * rows), s.code, 0.75, 0.78, 0.85);
        }
      }
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      rendererRef.current = null;
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.setItems(items);
  }, [items]);

  useEffect(() => {
    rendererRef.current?.setShowTodayLight(showTodayLight);
  }, [showTodayLight]);

  return <canvas ref={canvasRef} className={className} aria-label="ASCII 크리스마스 트리" />;
}
