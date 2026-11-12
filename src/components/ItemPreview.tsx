"use client";

import { useEffect, useRef } from "react";
import { MAT_LIGHT, SHADE, STRIDE, SURFACE_DENSITY, buildItemPreview, shadePoint, type TreeItem } from "@/lib/ascii-scene";

// 후보 카드 안에서 아이템 하나를 트리와 같은 방식(3D 점 → ASCII)으로 천천히 돌려 보여 준다.

const FONT_SIZE = 5;
const FILL = 0.4; // 아이템이 칸의 몇 할을 차지할지 (반지름 기준)
const CAMERA_DISTANCE = 4; // 반지름 1 기준
const SPIN_SPEED = 0.7; // rad/s
const FRAME_INTERVAL = 1000 / 30;
const POINTS_PER_PX2 = 0.35; // 빈틈 없이 칸을 채우는 점 밀도
const SNOWFLAKES = 28;

// 납작한 것은 위에서, 나머지는 살짝 내려다본다
const TILT: Partial<Record<TreeItem["itemType"], number>> = { carpet: 0.85, gift: 0.35, teddy: 0.2 };

export default function ItemPreview({ item, className }: { item: TreeItem; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const fontFamily = getComputedStyle(document.body).getPropertyValue("--font-geist-mono").trim() || "monospace";
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const { radius } = buildItemPreview(item, 0.05);

    // 대화상자가 열리기 전에는 크기가 0이라, 크기는 그릴 때마다 확인하고 바뀌면 다시 맞춘다
    let width = 0;
    let height = 0;
    let cellW = 1;
    const cellH = FONT_SIZE;
    let cols = 0;
    let rows = 0;
    let unit = 1;
    let cloud: Float32Array = new Float32Array(0);
    let depth = new Float32Array(0);
    let point = new Int32Array(0);
    const layout = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      if (width === 0 || height === 0) return false;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${FONT_SIZE}px ${fontFamily}`;
      ctx.textBaseline = "top";
      cellW = ctx.measureText("M").width;
      cols = Math.ceil(width / cellW);
      rows = Math.ceil(height / cellH);
      unit = (Math.min(width, height) * FILL) / radius;
      const density = Math.min(12, Math.max(0.15, (POINTS_PER_PX2 * unit * unit) / SURFACE_DENSITY));
      cloud = buildItemPreview(item, density).cloud;
      depth = new Float32Array(cols * rows);
      point = new Int32Array(cols * rows);
      return true;
    };

    const tilt = TILT[item.itemType] ?? 0.15;
    const cosT = Math.cos(tilt);
    const sinT = Math.sin(tilt);
    const glowAll = item.itemType === "star";
    const toRgb = (r: number, g: number, b: number) =>
      `rgb(${Math.round(Math.min(1, r) * 255)}, ${Math.round(Math.min(1, g) * 255)}, ${Math.round(Math.min(1, b) * 255)})`;

    const flakes = Array.from({ length: SNOWFLAKES }, () => ({
      x: Math.random(),
      y: Math.random(),
      speed: 0.12 + Math.random() * 0.18,
      phase: Math.random() * Math.PI * 2,
      ch: Math.random() < 0.6 ? "*" : ".",
    }));

    const rocks = item.itemType === "star" || item.itemType === "light";
    let rotation = rocks ? 0 : 0.6;
    let frame = 0;
    let last = performance.now();
    const draw = (time: number) => {
      frame = requestAnimationFrame(draw);
      if (time - last < FRAME_INTERVAL - 1) return;
      const dt = Math.min((time - last) / 1000, 0.1);
      last = time;
      if ((canvas.clientWidth !== width || canvas.clientHeight !== height) && !layout()) return;
      // 납작한 별·전구 줄은 옆면이 보이면 모양이 무너져서 좌우로만 흔든다
      if (!reduceMotion) rotation = rocks ? 0.5 * Math.sin(time * 0.0012) : rotation + dt * SPIN_SPEED;
      ctx.clearRect(0, 0, width, height);

      if (item.itemType === "snow") {
        ctx.shadowBlur = 4;
        for (const f of flakes) {
          if (!reduceMotion) {
            f.y += f.speed * dt;
            f.x += Math.sin(time * 0.002 + f.phase) * 0.02 * dt;
            if (f.y > 1) {
              f.y = 0;
              f.x = Math.random();
            }
          }
          ctx.fillStyle = ctx.shadowColor = f.ch === "*" ? "rgb(235, 242, 255)" : "rgb(170, 185, 210)";
          ctx.fillText(f.ch, Math.floor(f.x * cols) * cellW, Math.floor(f.y * rows) * cellH);
        }
        ctx.shadowBlur = 0;
        return;
      }

      const cosR = Math.cos(rotation);
      const sinR = Math.sin(rotation);
      const cx = width / 2;
      const cy = height / 2;
      depth.fill(-Infinity);
      point.fill(-1);
      for (let i = 0; i < cloud.length; i += STRIDE) {
        const x = cloud[i];
        const y = cloud[i + 1];
        const z = cloud[i + 2];
        const x1 = x * cosR - z * sinR;
        const z1 = x * sinR + z * cosR;
        const y2 = y * cosT - z1 * sinT;
        const z2 = y * sinT + z1 * cosT;
        const persp = CAMERA_DISTANCE / (CAMERA_DISTANCE - z2 / radius);
        const col = Math.floor((cx + x1 * unit * persp) / cellW);
        const row = Math.floor((cy - y2 * unit * persp) / cellH);
        if (col < 0 || col >= cols || row < 0 || row >= rows) continue;
        const cell = row * cols + col;
        if (z2 <= depth[cell]) continue;
        depth[cell] = z2;
        point[cell] = i;
      }

      for (let cell = 0; cell < point.length; cell++) {
        const i = point[cell];
        if (i < 0) continue;
        shadePoint(cloud, i, cosR, sinR, cosT, sinT, time);
        const style = toRgb(SHADE.r, SHADE.g, SHADE.b);
        const glow = glowAll || cloud[i + 11] === MAT_LIGHT;
        ctx.shadowBlur = glow ? cellH * 1.5 : 0;
        ctx.shadowColor = style;
        ctx.fillStyle = style;
        ctx.fillText(String.fromCharCode(SHADE.code), (cell % cols) * cellW, Math.floor(cell / cols) * cellH);
      }
      ctx.shadowBlur = 0;
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [item]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
