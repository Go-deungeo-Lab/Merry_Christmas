"use client";

import { useEffect, useRef } from "react";
import { MAT_LIGHT, SHADE, STRIDE, TILT, buildScene, shadePoint, type Scene, type TreeItem } from "@/lib/ascii-scene";
import { STAR_Y } from "@/lib/tree-geometry";
import styles from "./AsciiTree.module.css";

export type { TreeItem };

// 화면을 문자 칸 격자로 나누고, 3D 점 구름을 투영해 칸마다 가장 앞에 있는 점의 밝기로 문자를 고른다.
//
// 레이어
// 1. 기본 트리: 잎·눈 쌓인 가지·기둥·바닥. 모두에게 같다.
// 2. 아이템: items 데이터대로 그린다. 3D 점이라 트리와 함께 돌고 뒤로 가면 가려진다.
// 3. 오늘의 불빛: showTodayLight일 때만.
//
// 점 투영은 회전·크기·아이템이 바뀔 때만 다시 하고(정적 캔버스에 캐시),
// 매 프레임에는 반짝이는 것(전구·별·불빛·배경 별·눈)만 그 위에 그린다.

const BASE_ROWS_PER_UNIT = 84; // 넓은 화면에서 트리 높이 1당 문자 줄 수
const MIN_FONT = 6; // 좁은 화면에서는 줄 수(와 점 개수)를 줄여 이 크기 아래로 내려가지 않게
const CAMERA_DISTANCE = 5;
const INITIAL_ROTATION = 0.5;
const DRAG_SPEED = 0.01; // rad/px
const DRAG_THRESHOLD = 5; // 이보다 적게 움직이면 클릭
const HIT_RADIUS = 22; // 클릭 영역 반지름 (지름 44px)
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 3;
const MIN_ZOOM_FONT = 3; // 축소했을 때 글자 크기 하한
const BUTTON_ZOOM_STEP = 1.4;
const FRAME_INTERVAL = 1000 / 30;
const TODAY_LIGHT_Y = 1.0; // 별 바로 아래, 회전축 위라 항상 같은 자리
const BG_STAR_COUNT = 220;
const SNOW_COUNT = 120;
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
  zoomBy?: (factor: number) => void;
  resetZoom?: () => void;
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
    let baseUnit = 0; // 확대 전 트리 1단위의 화면 px
    let baseFont = 0;
    let zoom = 1;
    let panX = 0; // 확대한 상태에서 끌어서 옮긴 거리 (px)
    let panY = 0;
    let anchorX = 0; // 바닥 중심(원점)의 화면 위치
    let anchorY = 0;
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
      baseUnit = Math.min((height * 0.84) / 1.55, (width * 0.94) / 1.3);
      baseFont = Math.max(MIN_FONT, baseUnit / BASE_ROWS_PER_UNIT);
      // 칸이 줄어든 만큼 점도 줄인다 (0.1 단위로 끊어서 크기를 조금 바꿀 때마다 다시 만들지 않게).
      // 확대·축소는 글자와 트리를 같은 비율로 키우므로 점 밀도와는 상관없다.
      const ratio = baseUnit / baseFont / BASE_ROWS_PER_UNIT;
      const nextDensity = Math.max(0.1, Math.min(1, Math.round(ratio * ratio * 10) / 10));
      if (nextDensity !== density) {
        density = nextDensity;
        needsBuild = true;
      }
      applyZoom(true);
    };

    // 지도처럼 확대·축소한다: 화면 가운데를 기준으로 zoom배 키운 뒤 pan만큼 옮긴다.
    // 화면 위치 = 가운데 + zoom × (확대 전 위치 − 가운데) + pan
    const applyZoom = (reallocate = false) => {
      unit = baseUnit * zoom;
      fontSize = Math.max(MIN_ZOOM_FONT, baseFont * zoom);
      font = `${fontSize}px ${fontFamily}`;
      cellH = fontSize;
      rows = Math.ceil(height / cellH);
      // 확대했을 때만 옮길 수 있고, 트리가 화면 밖으로 사라지지 않을 만큼만
      const maxPanX = (width * Math.max(0, zoom - 1)) / 2;
      const maxPanY = (height * Math.max(0, zoom - 1)) / 2;
      panX = Math.max(-maxPanX, Math.min(maxPanX, panX));
      panY = Math.max(-maxPanY, Math.min(maxPanY, panY));
      const baseAnchorY = (height * 0.86 - 1.55 * baseUnit) / 2 + 1.3 * baseUnit;
      anchorX = width / 2 + panX;
      anchorY = height / 2 + (baseAnchorY - height / 2) * zoom + panY;
      // 글꼴이 늦게 로드돼 글자 폭이 바뀌어도 넘치지 않게 넉넉히. 확대·축소 중에는 커질 때만 새로 잡는다
      const needed = Math.ceil(width / (fontSize * 0.5)) * rows;
      if (reallocate || needed > capacity) {
        capacity = needed;
        depth = new Float32Array(capacity);
        cellChar = new Uint8Array(capacity);
        cellKey = new Uint16Array(capacity);
        cellPoint = new Int32Array(capacity);
        cellItem = new Int16Array(capacity);
        next = new Int32Array(capacity);
      }
      needsProject = true;
    };

    // (mx, my) 지점이 손가락·커서 아래에 그대로 남도록 확대·축소한다
    const zoomAt = (mx: number, my: number, nextZoom: number) => {
      const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
      const qx = (mx - width / 2 - panX) / zoom;
      const qy = (my - height / 2 - panY) / zoom;
      zoom = clamped;
      panX = mx - width / 2 - zoom * qx;
      panY = my - height / 2 - zoom * qy;
      applyZoom();
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
      const cx = anchorX;
      const baseY = anchorY; // 바닥 중심의 화면 y
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
        if (cloud[i + 11] === MAT_LIGHT) continue; // 전구는 매 프레임 따로 그린다

        shadePoint(cloud, i, cosR, sinR, cosT, sinT, 0);
        cellChar[cell] = SHADE.code;
        cellKey[cell] = quantize(SHADE.r, SHADE.g, SHADE.b);
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

    // 한 손가락: 가로로 끌면 회전, 세로로 끌면 위아래 이동(확대했을 때). 짧게 누르면 클릭.
    // 두 손가락: 핀치로 확대·축소, 함께 움직이면 이동.
    const pointers = new Map<number, { x: number; y: number }>();
    let single: { id: number; startX: number; startY: number; lastX: number; lastY: number; dragging: boolean } | null = null;
    let pinch: { startDist: number; startZoom: number; midX: number; midY: number } | null = null;
    const localPoint = (e: PointerEvent): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      return [e.clientX - rect.left, e.clientY - rect.top];
    };
    const pinchState = () => {
      const [a, b] = [...pointers.values()];
      return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
    };
    // 포인터가 이미 떨어졌으면 예외가 나므로 무시한다
    const capture = (id: number) => {
      try {
        canvas.setPointerCapture(id);
      } catch {}
    };
    const onPointerDown = (e: PointerEvent) => {
      const [x, y] = localPoint(e);
      pointers.set(e.pointerId, { x, y });
      if (pointers.size === 1) {
        single = { id: e.pointerId, startX: x, startY: y, lastX: x, lastY: y, dragging: false };
      } else if (pointers.size === 2) {
        // 두 번째 손가락이 닿으면 핀치로 바뀌고, 이번 터치는 클릭으로 치지 않는다
        single = null;
        const { dist, midX, midY } = pinchState();
        pinch = { startDist: dist, startZoom: zoom, midX, midY };
        for (const id of pointers.keys()) capture(id);
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      const [x, y] = localPoint(e);
      if (!pointers.has(e.pointerId)) {
        if (e.pointerType === "mouse") canvas.style.cursor = hitTest(x, y) ? "pointer" : "";
        return;
      }
      pointers.set(e.pointerId, { x, y });

      if (pinch && pointers.size >= 2) {
        const { dist, midX, midY } = pinchState();
        panX += midX - pinch.midX;
        panY += midY - pinch.midY;
        pinch.midX = midX;
        pinch.midY = midY;
        zoomAt(midX, midY, pinch.startZoom * (dist / pinch.startDist));
        return;
      }

      if (single && e.pointerId === single.id) {
        if (!single.dragging && Math.hypot(x - single.startX, y - single.startY) >= DRAG_THRESHOLD) {
          single.dragging = true;
          capture(e.pointerId);
        }
        if (single.dragging) {
          rotation += (x - single.lastX) * DRAG_SPEED;
          if (zoom > 1) {
            panY += y - single.lastY;
            applyZoom();
          }
          single.lastX = x;
          single.lastY = y;
          needsProject = true;
        }
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pinch) {
        if (pointers.size === 0) pinch = null;
        return;
      }
      if (!single || e.pointerId !== single.id) return;
      const wasDrag = single.dragging;
      single = null;
      if (wasDrag) return;
      const [px, py] = localPoint(e);
      const hit = hitTest(px, py);
      if (hit?.type === "light") propsRef.current.onTodayLightClick?.();
      else if (hit?.type === "item") propsRef.current.onItemClick?.(hit.index);
    };
    const onPointerCancel = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      single = null;
      if (pointers.size === 0) pinch = null;
    };
    // 마우스 휠·트랙패드 핀치(ctrl+휠)로 커서 위치를 기준으로 확대·축소
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const speed = e.ctrlKey ? 0.01 : 0.0015;
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, zoom * Math.exp(-e.deltaY * speed));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });

    rendererRef.current = {
      ...rendererRef.current!,
      zoomBy: (factor) => zoomAt(width / 2, height / 2, zoom * factor),
      resetZoom: () => {
        zoom = 1;
        panX = 0;
        panY = 0;
        applyZoom();
      },
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

      for (const cell of lightCells) {
        shadePoint(cloud, cellPoint[cell], 1, 0, cosT, sinT, time);
        drawChar(cell % cols, Math.floor(cell / cols), SHADE.code, SHADE.r, SHADE.g, SHADE.b, true);
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
      canvas.removeEventListener("wheel", onWheel);
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.setItems(items);
  }, [items]);

  useEffect(() => {
    rendererRef.current?.setShowTodayLight(showTodayLight);
  }, [showTodayLight]);

  return (
    <>
      <canvas ref={canvasRef} className={className} aria-label="ASCII 크리스마스 트리" />
      <div className={styles.zoom} role="group" aria-label="트리 확대·축소">
        <button type="button" aria-label="확대" onClick={() => rendererRef.current?.zoomBy?.(BUTTON_ZOOM_STEP)}>
          +
        </button>
        <button type="button" aria-label="축소" onClick={() => rendererRef.current?.zoomBy?.(1 / BUTTON_ZOOM_STEP)}>
          −
        </button>
        <button type="button" aria-label="원래 크기로" onClick={() => rendererRef.current?.resetZoom?.()}>
          ↺
        </button>
      </div>
    </>
  );
}
