"use client";

import { useEffect, useRef } from "react";

const W = 440;
const H = 330;
const SPINE = 220;
const PAGE_TOP = 70;
const PAGE_BOTTOM = 274;
const OUTER_L = 50;
const OUTER_R = 390;
const STACK_COUNT = 8;
const STACK_STEP = 2.4;
const STACK_DEPTH = (STACK_COUNT - 1) * STACK_STEP;
const COVER_PAD = 7;
const PAGE_W = OUTER_R - SPINE;
/** Muted paper — soft blue-grey, easier on eyes against the black hero. */
const PAGE_FILL = "#c4c9d6";
const PAGE_LIP = "#9aa3b6";
/** Dark indigo cover — visible against black hero bg, on-brand blue shift. */
const COVER_OUTER = "#22224a";
const COVER_MID = "#181836";
const COVER_SPINE = "#12122a";
/** Turning-sheet outward bow (trapezoid 3D); peaks at mid-flip. */
const FLIP_LIFT = 24;

type Pt = { x: number; y: number };

function quad(ctx: CanvasRenderingContext2D, pts: Pt[], fill: string | CanvasGradient) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function pageHalf(side: "left" | "right", layer: number): Pt[] {
  const off = layer * STACK_STEP;
  if (side === "left") {
    const x = OUTER_L - off;
    return [
      { x, y: PAGE_TOP },
      { x: SPINE, y: PAGE_TOP },
      { x: SPINE, y: PAGE_BOTTOM },
      { x, y: PAGE_BOTTOM },
    ];
  }
  const x = OUTER_R + off;
  return [
    { x: SPINE, y: PAGE_TOP },
    { x, y: PAGE_TOP },
    { x, y: PAGE_BOTTOM },
    { x: SPINE, y: PAGE_BOTTOM },
  ];
}

function coverHalf(side: "left" | "right"): Pt[] {
  const y0 = PAGE_TOP - COVER_PAD;
  const y1 = PAGE_BOTTOM + COVER_PAD;
  if (side === "left") {
    return [
      { x: OUTER_L - STACK_DEPTH - COVER_PAD, y: y0 },
      { x: SPINE + 3, y: y0 },
      { x: SPINE + 3, y: y1 },
      { x: OUTER_L - STACK_DEPTH - COVER_PAD, y: y1 },
    ];
  }
  return [
    { x: SPINE - 3, y: y0 },
    { x: OUTER_R + STACK_DEPTH + COVER_PAD, y: y0 },
    { x: OUTER_R + STACK_DEPTH + COVER_PAD, y: y1 },
    { x: SPINE - 3, y: y1 },
  ];
}

function stackTone(layer: number) {
  return `hsl(228, 9%, ${76 - layer * 1.35}%)`;
}

function coverGradient(ctx: CanvasRenderingContext2D, side: "left" | "right") {
  if (side === "left") {
    const x0 = OUTER_L - STACK_DEPTH - COVER_PAD;
    const g = ctx.createLinearGradient(x0, 0, SPINE, 0);
    g.addColorStop(0, COVER_OUTER);
    g.addColorStop(0.5, COVER_MID);
    g.addColorStop(1, COVER_SPINE);
    return g;
  }
  const x1 = OUTER_R + STACK_DEPTH + COVER_PAD;
  const g = ctx.createLinearGradient(x1, 0, SPINE, 0);
  g.addColorStop(0, COVER_OUTER);
  g.addColorStop(0.5, COVER_MID);
  g.addColorStop(1, COVER_SPINE);
  return g;
}

/** Mirrored gutter shadow — darkest at the spine, fading outward into each page. */
function spineShadowGradient(
  ctx: CanvasRenderingContext2D,
  side: "left" | "right",
  reach: number,
) {
  const x1 = side === "left" ? SPINE - reach : SPINE + reach;
  const g = ctx.createLinearGradient(SPINE, 0, x1, 0);
  g.addColorStop(0, "rgba(0, 0, 0, 0.11)");
  g.addColorStop(0.28, "rgba(0, 0, 0, 0.05)");
  g.addColorStop(0.62, "rgba(0, 0, 0, 0.018)");
  g.addColorStop(1, "rgba(0, 0, 0, 0)");
  return g;
}

function drawStaticPageSpineShadow(ctx: CanvasRenderingContext2D, side: "left" | "right") {
  const reach = 40;
  const pts = pageHalf(side, 0);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = spineShadowGradient(ctx, side, reach);
  ctx.fillRect(
    side === "left" ? SPINE - reach : SPINE,
    PAGE_TOP,
    reach,
    PAGE_BOTTOM - PAGE_TOP,
  );
  ctx.restore();
}

function drawStaticBook(ctx: CanvasRenderingContext2D) {
  quad(ctx, coverHalf("left"), coverGradient(ctx, "left"));
  quad(ctx, coverHalf("right"), coverGradient(ctx, "right"));

  // Deep stack (grey striations only visible at fore-edge).
  for (let layer = STACK_COUNT - 1; layer >= 2; layer--) {
    quad(ctx, pageHalf("left", layer), stackTone(layer));
    quad(ctx, pageHalf("right", layer), stackTone(layer));
  }

  quad(ctx, pageHalf("left", 1), PAGE_FILL);
  quad(ctx, pageHalf("left", 0), PAGE_FILL);
  drawStaticPageSpineShadow(ctx, "left");
  quad(ctx, pageHalf("right", 1), PAGE_FILL);
  quad(ctx, pageHalf("right", 0), PAGE_FILL);
  drawStaticPageSpineShadow(ctx, "right");

  ctx.strokeStyle = "rgba(0,0,0,0.07)";
  for (let i = 2; i < STACK_COUNT; i++) {
    const lx = OUTER_L - i * STACK_STEP;
    const rx = OUTER_R + i * STACK_STEP;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(lx, PAGE_TOP + 2);
    ctx.lineTo(lx, PAGE_BOTTOM - 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(rx, PAGE_TOP + 2);
    ctx.lineTo(rx, PAGE_BOTTOM - 2);
    ctx.stroke();
  }

  ctx.fillStyle = PAGE_LIP;
  ctx.beginPath();
  ctx.roundRect(OUTER_L - STACK_DEPTH, PAGE_BOTTOM, STACK_DEPTH, 3, 0.5);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(OUTER_R, PAGE_BOTTOM, STACK_DEPTH, 3, 0.5);
  ctx.fill();
}

function turningPagePath(
  ctx: CanvasRenderingContext2D,
  foreX: number,
  spineTop: number,
  spineBot: number,
  lift: number,
) {
  ctx.beginPath();
  ctx.moveTo(SPINE, spineTop);
  ctx.lineTo(foreX, spineTop - lift);
  ctx.lineTo(foreX, spineBot + lift);
  ctx.lineTo(SPINE, spineBot);
  ctx.closePath();
}

/** Spine crease on the turning sheet — darkest at the hinge, fading toward the fore-edge only. */
function drawTurningPageSpineShadow(
  ctx: CanvasRenderingContext2D,
  foreX: number,
  spineTop: number,
  spineBot: number,
  lift: number,
) {
  const pageW = Math.abs(foreX - SPINE);
  const shadowW = Math.min(28, pageW * 0.32 + 6);
  const extendsRight = foreX > SPINE;
  const fadeX = extendsRight ? SPINE + shadowW : SPINE - shadowW;
  const g = ctx.createLinearGradient(SPINE, 0, fadeX, 0);
  g.addColorStop(0, "rgba(0, 0, 0, 0.11)");
  g.addColorStop(0.4, "rgba(0, 0, 0, 0.045)");
  g.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(
    extendsRight ? SPINE : SPINE - shadowW,
    spineTop - Math.abs(lift) * 0.2,
    shadowW,
    spineBot - spineTop + Math.abs(lift) * 0.4,
  );
}

function drawTurningPage(ctx: CanvasRenderingContext2D, angle: number) {
  const pageH = PAGE_BOTTOM - PAGE_TOP;
  const cosA = Math.cos(angle);
  const w = PAGE_W * Math.abs(cosA);
  const lift = Math.sin(angle) * FLIP_LIFT;

  if (w < 2) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(SPINE - 1, PAGE_TOP, 2, pageH);
    ctx.clip();
    ctx.fillStyle = PAGE_FILL;
    ctx.fillRect(SPINE - 1, PAGE_TOP, 2, pageH);
    ctx.fillStyle = "rgba(0, 0, 0, 0.09)";
    ctx.fillRect(SPINE - 1, PAGE_TOP, 2, pageH);
    ctx.restore();
    return;
  }

  const foreX = cosA >= 0 ? SPINE + w : SPINE - w;
  const spineTop = PAGE_TOP;
  const spineBot = PAGE_BOTTOM;

  ctx.save();
  ctx.beginPath();
  ctx.rect(OUTER_L - 8, PAGE_TOP - FLIP_LIFT - 4, OUTER_R - OUTER_L + 16, pageH + (FLIP_LIFT + 4) * 2);
  ctx.clip();

  turningPagePath(ctx, foreX, spineTop, spineBot, lift);
  ctx.fillStyle = PAGE_FILL;
  ctx.fill();

  turningPagePath(ctx, foreX, spineTop, spineBot, lift);
  ctx.clip();
  drawTurningPageSpineShadow(ctx, foreX, spineTop, spineBot, lift);
  ctx.restore();
}

function drawFrame(ctx: CanvasRenderingContext2D, t: number) {
  ctx.clearRect(0, 0, W, H);

  const cycle = 1.25;
  const phase = (t % cycle) / cycle;
  const REST = 0.04;
  const TURN_END = 1 - REST;

  const turning = phase >= REST && phase < TURN_END;
  let angle = 0;
  if (turning) {
    const turnP = (phase - REST) / (TURN_END - REST);
    angle = turnP * Math.PI;
  }

  drawStaticBook(ctx);

  if (turning) {
    drawTurningPage(ctx, angle);
  }
}

export default function BookFlipCanvas({
  scale = 1,
  reducedMotion: reducedMotionOverride,
}: {
  scale?: number;
  /** When false, always animate (e.g. dev preview). Default: respect system setting. */
  reducedMotion?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const startRef = useRef<number | null>(null);
  const displayW = W * scale;
  const displayH = H * scale;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    startRef.current = null;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = displayW * dpr;
    canvas.height = displayH * dpr;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);

    let raf = 0;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const isReduced = () => reducedMotionOverride ?? mq.matches;

    const tick = (now: number) => {
      if (startRef.current === null) startRef.current = now;
      const t = isReduced() ? 0 : (now - startRef.current) / 1000;
      drawFrame(ctx, t);
      if (!isReduced()) {
        raf = requestAnimationFrame(tick);
      }
    };

    const onMotionChange = () => {
      cancelAnimationFrame(raf);
      startRef.current = null;
      if (!isReduced()) {
        raf = requestAnimationFrame(tick);
      } else {
        drawFrame(ctx, 0);
      }
    };

    drawFrame(ctx, 0);
    if (!isReduced()) {
      raf = requestAnimationFrame(tick);
    }
    mq.addEventListener("change", onMotionChange);

    return () => {
      cancelAnimationFrame(raf);
      mq.removeEventListener("change", onMotionChange);
    };
  }, [scale, reducedMotionOverride, displayW, displayH]);

  return (
    <div
      className="relative select-none"
      style={{ width: displayW, height: displayH }}
      aria-hidden
    >
      {/* Circular glow — same technique as HomeLanding ambient blurs */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-visible">
        <div
          className="absolute rounded-full blur-[100px]"
          style={{
            width: displayW * 0.9,
            height: displayW * 0.9,
            background: "color-mix(in srgb, #0000ff 24%, transparent)",
          }}
        />
        <div
          className="absolute rounded-full blur-[120px]"
          style={{
            width: displayW * 1.1,
            height: displayW * 1.1,
            background: "color-mix(in srgb, #8d00ff 16%, transparent)",
          }}
        />
      </div>
      <canvas
        ref={canvasRef}
        className="relative z-10 block"
        style={{ width: displayW, height: displayH }}
      />
    </div>
  );
}
