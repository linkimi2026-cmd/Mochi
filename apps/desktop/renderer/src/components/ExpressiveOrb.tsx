import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import "./ExpressiveOrb.css";

/**
 * A small status avatar for the collaboration assistant.
 *
 * The feel is translated from the Grok Bot mark and Kimi's voice-mode orb:
 * a near-black sphere with two light eyes, whose silhouette, gaze and colour
 * all glide in place instead of swapping. Four qualities are reimplemented
 * here from scratch rather than copied:
 *
 *   1. Organic silhouette — a Catmull-Rom blob whose radius is modulated by
 *      three incommensurate sine waves, so the outline never loops or sits
 *      still.
 *   2. Spring physics — eye size, gaze and face lift chase their targets
 *      through a damped spring integrator, so state changes overshoot and
 *      settle like jelly.
 *   3. Wandering gaze — the eyes pick a new resting target every few seconds
 *      (biased by mood) and drift there with inertia.
 *   4. In-place morphs — colour, wobble amplitude, wobble speed and breathing
 *      period are all lerped per frame toward the mood's tuning, so a state
 *      change is one continuous deformation of the same ball, never a swap.
 *
 *   5. Squash & stretch — blinks squash the whole body a few percent, with
 *      the occasional very human double blink.
 *
 *   6. Poke response — pressing the ball squashes it like jelly, squints the
 *      eyes, dips the face and warms the colour for a beat, all springing
 *      back with overshoot. Purely decorative, so taps inside nav links or
 *      buttons keep their original behaviour.
 *
 * Rendering stays on SVG with one rAF loop per active instance; rAF pauses
 * automatically when the tab is hidden. This stays far cheaper than a WebGL
 * solver for the up-to-a-dozen copies a chat transcript can mount, on school
 * mobile devices.
 */
export type ExpressiveOrbMood =
  | "idle"
  | "thinking"
  | "listening"
  | "speaking"
  | "success"
  | "alert";

type ExpressiveOrbProps = {
  size?: number;
  mood?: ExpressiveOrbMood;
  /** When false the orb settles into its still pose and stops animating. */
  active?: boolean;
  /** Set false to disable the jelly poke response (still orbs fall back to a CSS press). */
  interactive?: boolean;
  /** Provide for a standalone, non-decorative orb so screen readers announce it. */
  label?: string;
  className?: string;
};

const MOOD_LABEL: Record<ExpressiveOrbMood, string> = {
  idle: "待机",
  thinking: "正在处理",
  listening: "正在聆听",
  speaking: "正在回复",
  success: "已完成",
  alert: "需要留意",
};

/**
 * Per-mood tuning in viewBox units (0 0 100 100).
 * `open`/`wide` are the eye's vertical/horizontal radii, `lift` shifts the
 * whole face, `wobble`/`wobbleSpeed` shape the body's organic noise, and
 * `breath` is the seconds per breathing cycle.
 */
const TUNING: Record<
  ExpressiveOrbMood,
  { open: number; wide: number; lift: number; wobble: number; wobbleSpeed: number; breath: number }
> = {
  idle:      { open: 7.2, wide: 5.6, lift: 0,    wobble: 0.03,  wobbleSpeed: 0.55, breath: 3.8 },
  thinking:  { open: 5.2, wide: 5.6, lift: -2.6, wobble: 0.02,  wobbleSpeed: 0.95, breath: 1.9 },
  listening: { open: 8.6, wide: 6.1, lift: 0.6,  wobble: 0.022, wobbleSpeed: 0.62, breath: 2.6 },
  speaking:  { open: 6.4, wide: 5.8, lift: 0,    wobble: 0.034, wobbleSpeed: 0.85, breath: 2.1 },
  success:   { open: 4.2, wide: 5.4, lift: 1.6,  wobble: 0.016, wobbleSpeed: 0.45, breath: 4.8 },
  alert:     { open: 7.6, wide: 6.8, lift: -1.0, wobble: 0.012, wobbleSpeed: 1.5,  breath: 1.2 },
};

/**
 * Body colour per mood. The ball lives in this product's picture-book world:
 * a caramel family with cream eyes. All six moods stay inside one warm
 * caramel/amber band (hue ≈19–45°) — states are told apart by lightness and
 * behaviour (wobble, eyes, breath), never by jumping to another hue, so an
 * in-place morph reads as the same ball warming or settling rather than a
 * colour swap. Values lerp in place per frame.
 */
const MOOD_COLOR: Record<ExpressiveOrbMood, [number, number, number]> = {
  idle:      [0xa0, 0x6a, 0x32], // 焦糖（基准色）
  thinking:  [0x6f, 0x61, 0x4c], // 暗茶褐（沉下来、想事情）
  listening: [0xb9, 0x8a, 0x4e], // 暖亮砂（睁大眼睛、亮半档）
  speaking:  [0xc9, 0x91, 0x3c], // 亮琥珀（最亮、开口说话）
  success:   [0xa8, 0x8a, 0x40], // 蜜金（灰一点、满足地静）
  alert:     [0xa2, 0x4f, 0x28], // 赭棕（带一点红示警，仍在暖土带）
};

/** Where the gaze likes to rest for each mood, added to the random wander. */
const GAZE_BIAS: Record<ExpressiveOrbMood, [number, number]> = {
  idle: [0, 0],
  thinking: [1.6, -2.4],
  listening: [0, 0.6],
  speaking: [0, 0],
  success: [0, 1],
  alert: [0, -1.4],
};

const BLINK_MIN_S = 2.6;
const BLINK_MAX_S = 6.4;
const BLINK_S = 0.16;
/** Chance a blink is followed by a quick second one — a very human tic. */
const DOUBLE_BLINK_CHANCE = 0.18;

/** One damped spring step. Returns the next [position, velocity]. */
function spring(pos: number, vel: number, target: number, k: number, damping: number): [number, number] {
  const v = (vel + (target - pos) * k) * damping;
  return [pos + v, v];
}

/** Smooth closed curve through points (Catmull-Rom converted to cubic Béziers). */
function catmullRomClosed(pts: Array<[number, number]>): string {
  const n = pts.length;
  const at = (i: number) => pts[((i % n) + n) % n];
  let d = `M ${at(0)[0].toFixed(2)} ${at(0)[1].toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return `${d} Z`;
}

/**
 * Organic body outline: base radius modulated by breathing plus three sine
 * waves at incommensurate frequencies and phases, so the wobble never
 * visually repeats.
 */
function organicBlob(t: number, base: number, amp: number, speed: number, breath: number): string {
  const N = 10;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r =
      base *
      (1 +
        0.014 * Math.sin((t * Math.PI * 2) / breath) +
        amp * Math.sin(t * speed + a * 2.0 + 0.8) +
        amp * 0.55 * Math.sin(t * speed * 1.63 + a * 3.0 + 2.1) +
        amp * 0.3 * Math.sin(t * speed * 2.31 + a * 5.0));
    pts.push([50 + Math.cos(a) * r, 50 + Math.sin(a) * r]);
  }
  return catmullRomClosed(pts);
}

type OrbPhysics = {
  mood: ExpressiveOrbMood;
  rx: number; rxV: number;
  ry: number; ryV: number;
  lift: number; liftV: number;
  gazeX: number; gazeXV: number;
  gazeY: number; gazeYV: number;
  gazeTarget: [number, number];
  nextGazeAt: number;
  amp: number;
  wobbleSpeed: number;
  breath: number;
  color: [number, number, number];
  blinkStart: number;
  blinkDouble: boolean;
  nextBlinkAt: number;
  /** Poke response: 1 = freshly pressed, springs back through a jelly overshoot. */
  poke: number;
  pokeV: number;
};

export function ExpressiveOrb({
  size = 48,
  mood = "idle",
  active = true,
  label,
  className = "",
  interactive = true,
}: ExpressiveOrbProps) {
  const depthGradientId = `eob-${useId().replace(/[^a-zA-Z0-9]/g, "")}-depth`;

  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduceMotion(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const still = !active || reduceMotion;

  const tune = TUNING[mood];
  // The rAF loop owns every later frame. State keeps only the first paint,
  // so mood changes cannot reset the animated path mid-frame.
  const [initialD] = useState(() => organicBlob(0, 42, tune.wobble, tune.wobbleSpeed, tune.breath));

  const bodyRef = useRef<SVGPathElement | null>(null);
  const shadowRef = useRef<SVGEllipseElement | null>(null);
  const squashRef = useRef<SVGGElement | null>(null);
  const faceRef = useRef<SVGGElement | null>(null);
  const eyesRef = useRef<SVGGElement | null>(null);
  const eyeLRef = useRef<SVGEllipseElement | null>(null);
  const eyeRRef = useRef<SVGEllipseElement | null>(null);

  const physics = useRef<OrbPhysics>({
    mood,
    rx: tune.wide, rxV: 0,
    ry: tune.open, ryV: 0,
    lift: tune.lift, liftV: 0,
    gazeX: 0, gazeXV: 0,
    gazeY: 0, gazeYV: 0,
    gazeTarget: [0, 0],
    nextGazeAt: 0,
    amp: tune.wobble,
    wobbleSpeed: tune.wobbleSpeed,
    breath: tune.breath,
    color: [...MOOD_COLOR[mood]],
    blinkStart: -1,
    blinkDouble: false,
    nextBlinkAt: 1.4,
    poke: 0,
    pokeV: 0,
  });

  useEffect(() => {
    physics.current.mood = mood;
  }, [mood]);

  /**
   * Poke: press the ball and it squashes, squints, dips, glows warmer and
   * looks up at you — then everything springs back through a jelly overshoot.
   * Purely decorative; never prevents default, so a poke inside a nav link or
   * button keeps its original behaviour.
   */
  const handlePoke = () => {
    const s = physics.current;
    s.poke = 1;
    s.gazeTarget = [0, 2.2];
    s.nextGazeAt = performance.now() / 1000 + 1.4;
  };
  const pokeHandlers =
    interactive && !still
      ? {
          onPointerDown: handlePoke,
        }
      : {};

  useEffect(() => {
    const s = physics.current;
    const body = bodyRef.current;
    const shadow = shadowRef.current;
    const squash = squashRef.current;
    const face = faceRef.current;
    const eyes = eyesRef.current;
    const eyeL = eyeLRef.current;
    const eyeR = eyeRRef.current;
    if (!body || !shadow || !squash || !face || !eyes || !eyeL || !eyeR) return;

    const writeFrame = (now: number, animate: boolean) => {
      const t = TUNING[s.mood];

      // --- blink scheduler (with the occasional double blink) ---
      let bs = 0;
      if (animate) {
        if (s.blinkStart < 0 && now >= s.nextBlinkAt) {
          s.blinkStart = now;
          s.blinkDouble = Math.random() < DOUBLE_BLINK_CHANCE;
        }
        if (s.blinkStart >= 0) {
          const p = (now - s.blinkStart) / BLINK_S;
          if (p >= 1) {
            s.blinkStart = -1;
            s.nextBlinkAt =
              now + (s.blinkDouble ? 0.24 : BLINK_MIN_S + Math.random() * (BLINK_MAX_S - BLINK_MIN_S));
          } else {
            bs = Math.sin(Math.PI * p);
          }
        }
      }

      // --- wandering gaze, biased by mood ---
      if (animate && now >= s.nextGazeAt) {
        const bias = GAZE_BIAS[s.mood];
        s.gazeTarget = [
          (Math.random() * 2 - 1) * 4.6 + bias[0],
          (Math.random() * 2 - 1) * 2.2 + bias[1],
        ];
        s.nextGazeAt = now + 2.2 + Math.random() * 2.6;
      }

      // --- springs: eyes, lift, gaze ---
      if (animate) {
        [s.rx, s.rxV] = spring(s.rx, s.rxV, t.wide, 0.016, 0.86);
        [s.ry, s.ryV] = spring(s.ry, s.ryV, t.open, 0.016, 0.86);
        [s.lift, s.liftV] = spring(s.lift, s.liftV, t.lift, 0.016, 0.86);
        [s.gazeX, s.gazeXV] = spring(s.gazeX, s.gazeXV, s.gazeTarget[0], 0.012, 0.9);
        [s.gazeY, s.gazeYV] = spring(s.gazeY, s.gazeYV, s.gazeTarget[1], 0.012, 0.9);
        // In-place morphs: silhouette and colour glide toward the mood's
        // tuning instead of snapping. This is the "same ball, new mood" feel.
        s.amp += (t.wobble - s.amp) * 0.07;
        s.wobbleSpeed += (t.wobbleSpeed - s.wobbleSpeed) * 0.07;
        s.breath += (t.breath - s.breath) * 0.04;
        const tc = MOOD_COLOR[s.mood];
        for (let i = 0; i < 3; i++) s.color[i] += (tc[i] - s.color[i]) * 0.065;
        // Poke decays through a soft overshoot: press → flatten → stretch → rest.
        [s.poke, s.pokeV] = spring(s.poke, s.pokeV, 0, 0.05, 0.82);
      }

      // --- write DOM ---
      const poke = Math.max(-0.5, Math.min(1, s.poke));
      body.setAttribute("d", organicBlob(now, 42 * (1 - 0.035 * Math.max(0, poke)), s.amp, s.wobbleSpeed, s.breath));
      const glow = 26 * Math.max(0, poke);
      const [r0, g0, b0] = s.color;
      body.setAttribute(
        "fill",
        `rgb(${Math.min(255, Math.round(r0 + glow))} ${Math.min(255, Math.round(g0 + glow))} ${Math.min(255, Math.round(b0 + glow))})`,
      );
      shadow.setAttribute("rx", (25 * (1 + 0.012 * Math.sin((now * Math.PI * 2) / s.breath))).toFixed(2));

      const tilt = animate ? 1.1 * Math.sin(now * 0.32 + 1.3) : 0;
      squash.setAttribute(
        "transform",
        `translate(50 50) rotate(${tilt.toFixed(2)}) scale(${(1 + 0.055 * poke + 0.03 * bs).toFixed(4)} ${(1 - 0.09 * poke - 0.05 * bs).toFixed(4)}) translate(-50 -50)`,
      );

      // Poked: the face dips and squints for a beat, then springs back up.
      face.setAttribute("transform", `translate(50 ${(52 + s.lift + 2.2 * Math.max(0, poke)).toFixed(2)})`);
      eyes.setAttribute(
        "transform",
        `translate(${s.gazeX.toFixed(2)} ${s.gazeY.toFixed(2)}) scale(1 ${((1 - 0.93 * bs) * (1 - 0.45 * Math.max(0, poke))).toFixed(3)})`,
      );
      for (const eye of [eyeL, eyeR]) {
        eye.setAttribute("rx", (s.rx * (1 + 0.15 * Math.max(0, poke))).toFixed(2));
        eye.setAttribute("ry", s.ry.toFixed(2));
      }
    };

    if (still) {
      // Static pose: springs parked on target, no blink, centered gaze.
      s.blinkStart = -1;
      writeFrame(0, false);
      return;
    }

    let raf = 0;
    const loop = (nowMs: number) => {
      writeFrame(nowMs / 1000, true);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [still]);

  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: the role is selected dynamically and each labelled branch supports aria-label.
    <span
      className={`expressive-orb expressive-orb--${mood}${className ? ` ${className}` : ""}`}
      data-mood={mood}
      data-still={still ? "true" : "false"}
      style={{ "--orb-size": `${size}px` } as CSSProperties}
      role={label ? "img" : undefined}
      aria-label={label ? `${label}（${MOOD_LABEL[mood]}）` : undefined}
      aria-hidden={label ? undefined : true}
      {...pokeHandlers}
    >
      <svg aria-hidden="true" viewBox="0 0 100 100" className="expressive-orb__svg">
        <defs>
          {/* Bottom inner shade only — weight, not a highlight. */}
          <radialGradient id={depthGradientId} cx="50%" cy="122%" r="78%">
            <stop offset="0%" stopColor="#000000" stopOpacity="0.22" />
            <stop offset="60%" stopColor="#000000" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Ground shadow breathes in counterpoint so the orb feels weighted. */}
        <ellipse ref={shadowRef} cx="50" cy="93.5" rx="25" ry="4.2" className="expressive-orb__shadow" />

        <g ref={squashRef}>
          <path ref={bodyRef} d={initialD} className="expressive-orb__body" />
          <circle cx="50" cy="50" r="41" fill={`url(#${depthGradientId})`} className="expressive-orb__depth" />

          <g ref={faceRef} transform="translate(50 52)">
            <g ref={eyesRef}>
              <ellipse ref={eyeLRef} cx={-11} cy={0} rx={5.6} ry={7.2} className="expressive-orb__eye" />
              <ellipse ref={eyeRRef} cx={11} cy={0} rx={5.6} ry={7.2} className="expressive-orb__eye" />
            </g>
          </g>
        </g>
      </svg>
    </span>
  );
}
