"use client";

import { useEffect, useRef } from "react";
import {
  CARPET_RADIUS,
  FLOOR_RADIUS,
  STAR_Y,
  TRUNK_HEIGHT,
  TRUNK_RADIUS,
  foliageRadius,
  foliageY,
} from "@/lib/tree-geometry";

// 화면을 문자 칸 격자로 나누고, 3D 점 구름을 투영해 칸마다 가장 앞에 있는 점의 밝기로 문자를 고른다.

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

const ROWS_PER_UNIT = 84; // 트리 높이 1당 문자 줄 수
const TILT = 0.22; // 위에서 내려다보는 각도 (rad)
const CAMERA_DISTANCE = 5;
const ROTATION_SPEED = 0.25; // rad/s
const FRAME_INTERVAL = 1000 / 30;
const AMBIENT = 0.38;
const SURFACE_DENSITY = 27000; // 물체 표면 1단위 면적당 점 수

const TREE_POINTS = 52000;
const LIGHT_COUNT = 170;
const ORNAMENT_COUNT = 16;
const CARPET_POINTS = 13000;
const FLOOR_POINTS = 6000;
const TODAY_LIGHT_Y = 1.0; // 오늘의 불빛 (별 바로 아래, 회전축 위라 항상 같은 자리)
const BG_STAR_COUNT = 220;
const SNOW_COUNT = 120;

const RED: Vec3 = [0.8, 0.1, 0.12];
const GOLD: Vec3 = [0.95, 0.7, 0.18];
const BLUE: Vec3 = [0.18, 0.32, 0.85];
const SILVER: Vec3 = [0.8, 0.82, 0.88];
const GREEN: Vec3 = [0.12, 0.55, 0.3];
const ORNAMENT_COLORS = [RED, GOLD, BLUE, SILVER];
const LIGHT_COLORS: Vec3[] = [
  [1, 0.82, 0.42],
  [1, 0.95, 0.82],
];

const GIFTS: { place: Placement; size: Vec3; box: Vec3; ribbon: Vec3 }[] = [
  { place: { x: -0.36, z: 0.34, yaw: 0.3 }, size: [0.2, 0.15, 0.18], box: RED, ribbon: GOLD },
  { place: { x: 0.5, z: 0.02, yaw: -0.4 }, size: [0.15, 0.12, 0.15], box: BLUE, ribbon: SILVER },
  { place: { x: -0.06, z: 0.55, yaw: 0.8 }, size: [0.12, 0.09, 0.12], box: GREEN, ribbon: RED },
  { place: { x: 0.05, z: -0.52, yaw: 0.1 }, size: [0.18, 0.13, 0.16], box: GOLD, ribbon: RED },
];
// 트리 바깥쪽을 바라보고 앉은 곰인형
const TEDDY_PLACE: Placement = { x: 0.33, z: 0.38, yaw: Math.atan2(0.33, 0.38) };

function normalize([x, y, z]: Vec3): Vec3 {
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

const LIGHT_DIR = normalize([-0.3, 0.5, 0.8]);
const HALF_DIR = normalize([LIGHT_DIR[0], LIGHT_DIR[1], LIGHT_DIR[2] + 1]);

// 같은 seed면 항상 같은 장면이 나오도록 하는 결정적 난수
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 점 하나 = [x, y, z, nx, ny, nz, r, g, b, ao, phase, material]
const STRIDE = 12;

class CloudBuilder {
  private data: number[] = [];

  add(x: number, y: number, z: number, n: Vec3, [r, g, b]: Vec3, ao: number, mat: number, phase = 0) {
    const [nx, ny, nz] = normalize(n);
    this.data.push(x, y, z, nx, ny, nz, r, g, b, ao, phase, mat);
  }

  addPlaced(p: Placement, x: number, y: number, z: number, [nx, ny, nz]: Vec3, color: Vec3, ao: number, mat: number) {
    const c = Math.cos(p.yaw);
    const s = Math.sin(p.yaw);
    this.add(p.x + x * c + z * s, y, p.z - x * s + z * c, [nx * c + nz * s, ny, -nx * s + nz * c], color, ao, mat);
  }

  build() {
    return Float32Array.from(this.data);
  }
}

const ORIGIN: Placement = { x: 0, z: 0, yaw: 0 };

function addEllipsoid(
  b: CloudBuilder,
  rand: () => number,
  place: Placement,
  [cx, cy, cz]: Vec3,
  [rx, ry, rz]: Vec3,
  color: Vec3,
  mat: number,
) {
  const area = (4 * Math.PI * (rx * ry + ry * rz + rx * rz)) / 3;
  const count = Math.ceil(area * SURFACE_DENSITY);
  for (let i = 0; i < count; i++) {
    const u = rand() * 2 - 1;
    const theta = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const dx = s * Math.cos(theta);
    const dz = s * Math.sin(theta);
    b.addPlaced(place, cx + dx * rx, cy + u * ry, cz + dz * rz, [dx / rx, u / ry, dz / rz], color, 1, mat);
  }
}

function addGift(b: CloudBuilder, rand: () => number, gift: (typeof GIFTS)[number]) {
  const [w, h, d] = gift.size;
  const band = 0.018;
  const sample = (area: number, point: () => Vec3, normal: Vec3) => {
    const count = Math.ceil(area * SURFACE_DENSITY);
    for (let i = 0; i < count; i++) {
      const [x, y, z] = point();
      // 윗면은 십자, 옆면은 세로 띠로 리본이 지나간다
      const color = Math.abs(x) < band || Math.abs(z) < band ? gift.ribbon : gift.box;
      b.addPlaced(gift.place, x, y, z, normal, color, 0.6 + 0.4 * (y / h), MAT_GIFT);
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
  addEllipsoid(b, rand, gift.place, [-0.024, h + 0.012, 0], [0.026, 0.014, 0.014], gift.ribbon, MAT_GIFT);
  addEllipsoid(b, rand, gift.place, [0.024, h + 0.012, 0], [0.026, 0.014, 0.014], gift.ribbon, MAT_GIFT);
}

function addTeddy(b: CloudBuilder, rand: () => number) {
  const fur: Vec3 = [0.55, 0.34, 0.18];
  const muzzle: Vec3 = [0.8, 0.62, 0.42];
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
    [[0, 0.128, 0.055], [0.03, 0.012, 0.012], RED], // 나비넥타이
  ];
  for (const [center, radius, color] of parts) {
    addEllipsoid(b, rand, TEDDY_PLACE, center, radius, color, MAT_FUR);
  }
}

const CARPET_RED: Vec3 = [0.62, 0.08, 0.1];
const CARPET_CREAM: Vec3 = [0.85, 0.78, 0.6];
const CARPET_GREEN: Vec3 = [0.08, 0.36, 0.18];

// 안쪽부터 빨간 바탕과 물결 무늬, 크림색 띠, 초록 띠, 테두리, 술. null이면 술 사이 빈틈
function carpetColor(r: number, a: number): Vec3 | null {
  if (r > CARPET_RADIUS) return Math.sin(a * 90) > 0 ? CARPET_CREAM : null;
  if (r > CARPET_RADIUS - 0.035) return CARPET_CREAM;
  if (r > 0.47) return CARPET_GREEN;
  if (r > 0.43) return CARPET_CREAM;
  if (Math.abs(r - 0.3 - 0.025 * Math.sin(a * 10)) < 0.022) return CARPET_CREAM;
  return CARPET_RED;
}

function buildScene() {
  const rand = mulberry32(1225);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand());
  const b = new CloudBuilder();

  for (let i = 0; i < TREE_POINTS; i++) {
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

  for (let i = 0; i < LIGHT_COUNT; i++) {
    const t = Math.min(1 - Math.sqrt(rand()), 0.93);
    const a = rand() * Math.PI * 2;
    const r = foliageRadius(t) * 1.02;
    const color = LIGHT_COLORS[i % LIGHT_COLORS.length];
    b.add(Math.cos(a) * r, foliageY(t, r), Math.sin(a) * r, [Math.cos(a), 0.4, Math.sin(a)], color, 1, MAT_LIGHT, rand() * Math.PI * 2);
  }

  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < ORNAMENT_COUNT; i++) {
    const t = 0.08 + 0.75 * (i / (ORNAMENT_COUNT - 1)) + 0.03 * gauss();
    const a = i * goldenAngle * 3;
    const size = 0.03 + rand() * 0.012;
    const r = foliageRadius(t) * 0.98 + size * 0.5;
    const center: Vec3 = [Math.cos(a) * r, foliageY(t, r) - size, Math.sin(a) * r];
    addEllipsoid(b, rand, ORIGIN, center, [size, size, size], ORNAMENT_COLORS[i % ORNAMENT_COLORS.length], MAT_ORNAMENT);
  }

  const trunkPoints = 2 * Math.PI * TRUNK_RADIUS * TRUNK_HEIGHT * SURFACE_DENSITY;
  for (let i = 0; i < trunkPoints; i++) {
    const a = rand() * Math.PI * 2;
    const y = rand() * TRUNK_HEIGHT;
    // 세로 나무껍질 결
    const bark = 0.7 + 0.2 * Math.sin(a * 14 + 0.4 * gauss()) + 0.15 * rand();
    const color: Vec3 = [0.4 * bark, 0.24 * bark, 0.12 * bark];
    // 가지 바로 아래는 그늘지게
    b.add(Math.cos(a) * TRUNK_RADIUS, y, Math.sin(a) * TRUNK_RADIUS, [Math.cos(a), 0, Math.sin(a)], color, 0.9 - 0.4 * (y / TRUNK_HEIGHT), MAT_WOOD);
  }

  for (let i = 0; i < CARPET_POINTS; i++) {
    const r = (CARPET_RADIUS + 0.035) * Math.sqrt(rand());
    const a = rand() * Math.PI * 2;
    const color = carpetColor(r, a);
    if (!color) continue;
    const ao = (0.5 + 0.5 * Math.min(1, r / 0.5)) * (0.8 + 0.2 * rand());
    b.add(Math.cos(a) * r, 0.004, Math.sin(a) * r, [0, 1, 0], color, ao, MAT_CARPET);
  }

  // 바닥은 카펫 바깥에만
  for (let i = 0; i < FLOOR_POINTS; i++) {
    const r = Math.sqrt(CARPET_RADIUS ** 2 + rand() * (FLOOR_RADIUS ** 2 - CARPET_RADIUS ** 2));
    const a = rand() * Math.PI * 2;
    const tone = 0.8 + 0.3 * rand();
    b.add(Math.cos(a) * r, 0, Math.sin(a) * r, [0, 1, 0], [0.16 * tone, 0.18 * tone, 0.27 * tone], 1, MAT_FLOOR);
  }

  for (const gift of GIFTS) addGift(b, rand, gift);
  addTeddy(b, rand);

  return b.build();
}

export default function AsciiTree({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const scene = buildScene();
    const bgStars = Array.from({ length: BG_STAR_COUNT }, () => ({
      x: Math.random(),
      y: Math.random() * 0.8,
      phase: Math.random() * Math.PI * 2,
      code: (Math.random() < 0.85 ? "." : "+").charCodeAt(0),
    }));
    const snow = Array.from({ length: SNOW_COUNT }, () => ({
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
    let cellH = 0;
    let rows = 0;
    let capacity = 0;
    let depth = new Float32Array(0);
    let cellChar = new Uint8Array(0);
    let cellKey = new Uint16Array(0);
    let cellGlow = new Uint8Array(0);
    let next = new Int32Array(0);
    const head = new Int32Array(1 << 15).fill(-1);
    const usedKeys: number[] = [];

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // 별~바닥 앞쪽까지 약 1.55 단위, 선물까지 가로 약 1.3 단위가 들어오도록
      unit = Math.min((height * 0.84) / 1.55, (width * 0.94) / 1.3);
      fontSize = Math.max(4, unit / ROWS_PER_UNIT);
      cellH = fontSize;
      rows = Math.ceil(height / cellH);
      // 글꼴이 늦게 로드돼 글자 폭이 바뀌어도 넘치지 않게 넉넉히
      capacity = Math.ceil(width / (fontSize * 0.5)) * rows;
      depth = new Float32Array(capacity);
      cellChar = new Uint8Array(capacity);
      cellKey = new Uint16Array(capacity);
      cellGlow = new Uint8Array(capacity);
      next = new Int32Array(capacity);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let rotation = 0;
    let dragging = false;
    let lastPointerX = 0;
    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      lastPointerX = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      rotation += (e.clientX - lastPointerX) * 0.01;
      lastPointerX = e.clientX;
    };
    const onPointerUp = () => {
      dragging = false;
    };
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    const cosT = Math.cos(TILT);
    const sinT = Math.sin(TILT);

    let frame = 0;
    let lastDraw = performance.now();
    const draw = (time: number) => {
      frame = requestAnimationFrame(draw);
      if (time - lastDraw < FRAME_INTERVAL - 1) return;
      const dt = Math.min((time - lastDraw) / 1000, 0.1);
      lastDraw = time;
      if (!dragging) rotation += dt * ROTATION_SPEED * (reduceMotion ? 0.3 : 1);

      ctx.font = `${fontSize}px ${fontFamily}`;
      ctx.textBaseline = "top";
      const cellW = ctx.measureText("M").width;
      const cols = Math.min(Math.ceil(width / cellW), Math.floor(capacity / rows));
      const cellCount = cols * rows;
      const cx = width / 2;
      const baseY = (height * 0.86 - 1.55 * unit) / 2 + 1.3 * unit; // 바닥 중심의 화면 y
      depth.fill(-Infinity, 0, cellCount);

      const cosR = Math.cos(rotation);
      const sinR = Math.sin(rotation);
      for (let i = 0; i < scene.length; i += STRIDE) {
        const x = scene[i];
        const y = scene[i + 1];
        const z = scene[i + 2];
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

        const nx = scene[i + 3];
        const nz = scene[i + 5];
        const nx1 = nx * cosR - nz * sinR;
        const nz1 = nx * sinR + nz * cosR;
        const ny2 = scene[i + 4] * cosT - nz1 * sinT;
        const nz2 = scene[i + 4] * sinT + nz1 * cosT;
        const diffuse = Math.max(0, nx1 * LIGHT_DIR[0] + ny2 * LIGHT_DIR[1] + nz2 * LIGHT_DIR[2]);
        const mat = scene[i + 11];

        let shade: number;
        let brightness: number;
        let spec = 0;
        if (mat === MAT_LIGHT) {
          shade = 0.5 + 0.5 * Math.sin(time * 0.004 + scene[i + 10]);
          brightness = 0.4 + 0.8 * shade;
        } else if (mat === MAT_ORNAMENT) {
          shade = 0.25 + 0.75 * diffuse;
          spec = Math.pow(Math.max(0, nx1 * HALF_DIR[0] + ny2 * HALF_DIR[1] + nz2 * HALF_DIR[2]), 24);
          brightness = 0.45 + 1.2 * shade;
        } else {
          shade = scene[i + 9] * (AMBIENT + (1 - AMBIENT) * diffuse);
          brightness = 0.45 + 1.5 * shade;
        }

        const ramp = RAMPS[mat];
        depth[cell] = z2;
        cellChar[cell] = ramp[Math.min(ramp.length - 1, Math.floor(Math.min(1, shade + spec) * ramp.length))];
        cellKey[cell] = quantize(
          scene[i + 6] * brightness + spec,
          scene[i + 7] * brightness + spec,
          scene[i + 8] * brightness + spec,
        );
        cellGlow[cell] = mat === MAT_LIGHT ? 1 : 0;
      }

      const put = (col: number, row: number, code: number, r: number, g: number, b: number, glow: number, onlyEmpty = false) => {
        if (col < 0 || col >= cols || row < 0 || row >= rows) return;
        const cell = row * cols + col;
        if (onlyEmpty && depth[cell] !== -Infinity) return;
        depth[cell] = Infinity;
        cellChar[cell] = code;
        cellKey[cell] = quantize(r, g, b);
        cellGlow[cell] = glow;
      };
      const axisCell = (y: number): [number, number] => {
        const persp = CAMERA_DISTANCE / (CAMERA_DISTANCE - y * sinT);
        return [Math.floor(cx / cellW), Math.floor((baseY - y * cosT * unit * persp) / cellH)];
      };

      for (const s of bgStars) {
        const tw = 0.25 + 0.2 * Math.sin(time * 0.002 + s.phase);
        put(Math.floor(s.x * cols), Math.floor(s.y * rows), s.code, tw, tw * 1.05, tw * 1.3, 0, true);
      }

      // 꼭대기 별과 빛줄기
      const [starCol, starRow] = axisCell(STAR_Y);
      const starPulse = 0.75 + 0.25 * Math.sin(time * 0.003);
      const rays: [number, number, number, string][] = [
        [0, -1, 8, "|"],
        [1, -1, 6, "/"],
        [-1, -1, 6, "\\"],
        [1, 0, 6, "-"],
        [-1, 0, 6, "-"],
        [1, 1, 3, "\\"],
        [-1, 1, 3, "/"],
      ];
      for (const [dx, dy, length, ch] of rays) {
        for (let k = 1; k <= length; k++) {
          const fade = (1 - k / (length + 1)) * starPulse;
          put(starCol + dx * k, starRow + dy * k, ch.charCodeAt(0), 1 * fade, 0.8 * fade, 0.35 * fade, 1);
        }
      }
      put(starCol, starRow, 64, 1, 0.92, 0.55, 1);

      // 오늘의 불빛
      const [lightCol, lightRow] = axisCell(TODAY_LIGHT_Y);
      const lightPulse = 0.5 + 0.5 * Math.sin(time * 0.004);
      put(lightCol, lightRow, 64, 1, 0.97, 0.85, 1);
      put(lightCol - 1, lightRow, 111, 1, 0.9, 0.6 + 0.3 * lightPulse, 1);
      put(lightCol + 1, lightRow, 111, 1, 0.9, 0.6 + 0.3 * lightPulse, 1);

      for (const s of snow) {
        if (!reduceMotion) {
          s.y += s.speed * dt;
          s.x += Math.sin(time * 0.001 + s.phase) * 0.004 * dt;
          if (s.y > 1) {
            s.y = 0;
            s.x = Math.random();
          }
        }
        put(Math.floor(s.x * cols), Math.floor(s.y * rows), s.code, 0.75, 0.78, 0.85, 0);
      }

      // 같은 색끼리 묶어서 fillStyle 변경을 줄인다
      ctx.clearRect(0, 0, width, height);
      usedKeys.length = 0;
      for (let cell = 0; cell < cellCount; cell++) {
        if (depth[cell] === -Infinity) continue;
        const key = cellKey[cell];
        if (head[key] === -1) usedKeys.push(key);
        next[cell] = head[key];
        head[key] = cell;
      }
      for (const key of usedKeys) {
        ctx.fillStyle = styleOf(key);
        for (let cell = head[key]; cell !== -1; cell = next[cell]) {
          ctx.fillText(charStrings[cellChar[cell]], (cell % cols) * cellW, Math.floor(cell / cols) * cellH);
        }
        head[key] = -1;
      }

      // 전구·별 빛 번짐
      ctx.shadowBlur = cellH * 1.5;
      for (let cell = 0; cell < cellCount; cell++) {
        if (depth[cell] === -Infinity || !cellGlow[cell]) continue;
        const style = styleOf(cellKey[cell]);
        ctx.fillStyle = style;
        ctx.shadowColor = style;
        ctx.fillText(charStrings[cellChar[cell]], (cell % cols) * cellW, Math.floor(cell / cols) * cellH);
      }
      ctx.shadowBlur = 0;

      const lightX = (lightCol + 0.5) * cellW;
      const lightY = (lightRow + 0.5) * cellH;
      const glowRadius = unit * 0.07 * (1 + lightPulse * 0.4);
      const gradient = ctx.createRadialGradient(lightX, lightY, 0, lightX, lightY, glowRadius);
      gradient.addColorStop(0, `rgba(255, 240, 190, ${0.35 + lightPulse * 0.25})`);
      gradient.addColorStop(1, "rgba(255, 240, 190, 0)");
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = gradient;
      ctx.fillRect(lightX - glowRadius, lightY - glowRadius, glowRadius * 2, glowRadius * 2);
      ctx.globalCompositeOperation = "source-over";
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-label="회전하는 ASCII 크리스마스 트리" />;
}
