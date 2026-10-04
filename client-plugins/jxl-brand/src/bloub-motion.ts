/*! bloub 0.1.1 · Jérémy Perret · engine reused under MIT.
MIT License

Copyright (c) 2026 Jérémy Perret

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
import { BotEngine, type BotFrame } from './vendor/bloub/engine';
import { POSES, type StateId } from './vendor/bloub/states';
import type { DotRender } from './vendor/bloub/decor';

export type MochiMotion = StateId;
export type CompanionState = 'idle' | 'thinking' | 'typing' | 'celebrate' | 'alert' | 'error' | 'sleep' | 'boot' | 'sending' | 'listening' | 'speaking';
type Phase = readonly [StateId, number];
// Durations respect upstream minDuration: a burst must reform before leaving.
export const MOTION_SCRIPTS: Record<CompanionState, { phases: readonly Phase[]; loop?: boolean; rest: StateId }> = {
  idle: { phases: [], rest: 'idle' },
  thinking: { phases: [['thinking', 2.6], ['orbit', 3.4], ['swirl', 1.3], ['comet', 2.4]], loop: true, rest: 'thinking' },
  typing: { phases: [['play', 2], ['thinking', 2.6]], loop: true, rest: 'play' },
  celebrate: { phases: [['burst', 2.6], ['wink', 1.6]], rest: 'idle' },
  alert: { phases: [['wide', 1.8], ['notify', 2.2]], rest: 'alert' },
  error: { phases: [['exclaim', 2]], rest: 'alert' },
  sleep: { phases: [], rest: 'sleep' },
  boot: { phases: [['egg', 1.8], ['hexagon', 1.6], ['swirl', 1.3]], rest: 'thinking' },
  sending: { phases: [['comet', 2.4]], rest: 'thinking' },
  listening: { phases: [['wide', 1.8]], rest: 'idle' },
  speaking: { phases: [['play', 2]], loop: true, rest: 'play' },
};
export function motionAt(state: CompanionState, seconds: number): StateId {
  if (state === 'idle' && seconds >= 120) return 'sleep';
  const script = MOTION_SCRIPTS[state];
  const duration = script.phases.reduce((total, phase) => total + phase[1], 0);
  let t = Math.max(0, seconds);
  if (script.loop && duration) t %= duration;
  for (const [id, length] of script.phases) { if (t < length) return id; t -= length; }
  return script.rest;
}

/** Screen Y points down; the engine's positive pitch points up. */
export function pointerLook(x: number, y: number, box: { x: number; y: number; width: number; height: number }) {
  if (box.width <= 0 || box.height <= 0) return null;
  return {
    yaw: Math.max(-28, Math.min(28, (x - box.x - box.width / 2) / box.width * 55)),
    pitch: Math.max(-18, Math.min(18, -(y - box.y - box.height / 2) / box.height * 36)),
    mix: 1, spin: 0, wander: 0,
  };
}

const NS = 'http://www.w3.org/2000/svg';
let serial = 0;
const attr = (node: Element, values: Record<string, string | number>) => {
  for (const [key, value] of Object.entries(values)) {
    const text = String(value);
    if (node.getAttribute(key) !== text) node.setAttribute(key, text);
  }
};
const svgNode = <K extends keyof SVGElementTagNameMap>(tag: K, parent: Element, attrs = {}) => {
  const node = parent.ownerDocument.createElementNS(NS, tag); attr(node, attrs); parent.appendChild(node); return node;
};

/** Mochi skin; upstream geometry, occlusion and face projection are unchanged. */
export function createPainter(svg: SVGSVGElement) {
  const id = `mochi-bloub-${++serial}`;
  svg.replaceChildren();
  attr(svg, { viewBox: '-158 -158 316 316', 'data-engine': 'bloub', 'aria-hidden': 'true', focusable: 'false' });
  const defs = svgNode('defs', svg);
  const clip = svgNode('clipPath', defs, { id: `${id}-clip` });
  const clipBody = svgNode('path', clip);
  const mask = svgNode('mask', defs, { id: `${id}-mask`, maskUnits: 'userSpaceOnUse', x:-158,y:-158,width:316,height:316 });
  const maskBody = svgNode('path', mask, {fill:'white'});
  const notch = svgNode('circle', mask, {fill:'black'});
  const rear = svgNode('g', svg, { fill: 'none', 'stroke-linecap': 'round' });
  const behind = svgNode('g', svg);
  const bodyGroup = svgNode('g', svg, {mask:`url(#${id}-mask)`});
  const body = svgNode('path', bodyGroup, { class:'expressive-orb__body', fill: '#a06a32', stroke: '#fff6e624', 'stroke-width': 0.7 });
  const face = svgNode('g', bodyGroup, { class:'expressive-orb__face', 'clip-path': `url(#${id}-clip)`, fill: '#fff6e6' });
  const eyes = [svgNode('path', face), svgNode('path', face)];
  const frontDots = svgNode('g', svg);
  const notif = svgNode('circle', svg, { fill: '#cfaf80', stroke: '#fff6e6', 'stroke-width': 1.5 });
  const front = svgNode('g', svg, { fill: 'none', 'stroke-linecap': 'round' });
  const arcs: Array<{ back: SVGPathElement; front: SVGPathElement; gradient: SVGLinearGradientElement; stops: SVGStopElement[] }> = [];
  const dots: Array<{ node: SVGGElement; circle: SVGCircleElement; path: SVGPathElement }> = [];
  const palette = ['#b9a681', '#839383', '#d2b184', '#a99989', '#9aaca0'];
  function drawDot(dot: DotRender, i: number, parent: SVGGElement) {
    let slot = dots[i];
    if (!slot) {
      const node = svgNode('g', parent);
      slot = dots[i] = { node, circle: svgNode('circle', node), path: svgNode('path', node) };
    }
    if (slot.node.parentNode !== parent) parent.appendChild(slot.node);
    attr(slot.node, { display: 'inline', opacity: dot.opacity * (dot.depth ?? 1), fill: dot.color ? palette[i % palette.length] : 'var(--mochi-pet-body,#a06a32)' });
    attr(slot.circle, { display: dot.d ? 'none' : 'inline', cx: dot.x, cy: dot.y, r: dot.r });
    attr(slot.path, { display: dot.d ? 'inline' : 'none', d: dot.d ?? '', transform: `translate(${dot.x} ${dot.y}) rotate(${dot.rot ?? 0}) scale(100)` });
  }
  return (frame: BotFrame) => {
    attr(body, { d: frame.bodyPath }); attr(clipBody, { d: frame.bodyPath }); attr(maskBody, { d: frame.bodyPath });
    attr(notch, frame.notch ? {cx:frame.notch.x,cy:frame.notch.y,r:frame.notch.r} : {r:0});
    attr(bodyGroup, { opacity: frame.bodyAlpha });
    eyes.forEach((eye, i) => attr(eye, { d: frame.eyes[i]?.d ?? '', transform: frame.eyes[i]?.matrix ?? '', opacity: frame.eyes[i]?.alpha ?? 0 }));
    frame.arcs.forEach((arc, i) => {
      let slot = arcs[i];
      if (!slot) {
        const gradient = svgNode('linearGradient', defs, { id: `${id}-arc-${i}`, gradientUnits: 'userSpaceOnUse' });
        slot = arcs[i] = { gradient, stops: [], back: svgNode('path', rear), front: svgNode('path', front) };
      }
      attr(slot.gradient, { x1: arc.grad.x1, x2: arc.grad.x2, y1: arc.grad.y1, y2: arc.grad.y2 });
      arc.grad.stops.forEach((_, j) => {
        const stop = slot.stops[j] ?? (slot.stops[j] = svgNode('stop', slot.gradient));
        attr(stop, { offset: j / Math.max(1, arc.grad.stops.length - 1), 'stop-color': palette[(i + j) % palette.length] });
      });
      for (const [node, d] of [[slot.back, arc.back], [slot.front, arc.front]] as const) attr(node, { d, stroke: `url(#${id}-arc-${i})`, 'stroke-width': arc.width, opacity: arc.opacity, display: 'inline' });
    });
    arcs.slice(frame.arcs.length).forEach(slot => { attr(slot.back, { display: 'none' }); attr(slot.front, { display: 'none' }); });
    frame.dots.forEach((dot, i) => drawDot(dot, i, frame.dotsBehind ? behind : frontDots));
    dots.slice(frame.dots.length).forEach(slot => attr(slot.node, { display: 'none' }));
    attr(notif, frame.notif ? { cx: frame.notif.x, cy: frame.notif.y, r: frame.notif.r, display: 'inline' } : { display: 'none' });
  };
}

export type MotionOptions = { state?: CompanionState; motion?: StateId; active?: boolean; interactive?: boolean; restart?: boolean };
/** One clock for a mounted character. React and native windows share this adapter. */
export function mountMotion(svg: SVGSVGElement, options: MotionOptions = {}) {
  const doc = svg.ownerDocument;
  const win = doc.defaultView!;
  const reduce = win.matchMedia('(prefers-reduced-motion: reduce)');
  let config = { state: 'idle' as CompanionState, active: true, interactive: true, ...options };
  const first = config.motion ?? motionAt(config.state, 0);
  const engine = new BotEngine(100, first);
  const paint = createPainter(svg);
  let time = 0, since = 0, last = 0, raf = 0, visible = true, disposed = false, pokeUntil = 0;
  const staticFrame = () => {
    const state = config.motion ?? motionAt(config.state, 0);
    paint(new BotEngine(100, state).sample(POSES[state]));
    svg.dataset.motion = state;
  };
  const canAnimate = () => config.active && visible && !doc.hidden && !reduce.matches && !disposed;
  function render() {
    let target = config.motion ?? motionAt(config.state, time - since);
    if (pokeUntil > time && config.state === 'idle' && !config.motion) target = 'wink';
    if (target !== engine.state) engine.setState(target, time);
    paint(engine.sample(time)); svg.dataset.motion = target;
  }
  function tick(now: number) {
    raf = 0;
    if (!canAnimate()) return;
    if (!last) last = now;
    const delta = now - last;
    if (delta >= 1000 / 30) { time += Math.min(delta, 100) / 1000; last = now; render(); }
    raf = win.requestAnimationFrame(tick);
  }
  function wake() {
    win.cancelAnimationFrame(raf); raf = 0; last = 0;
    svg.dataset.motionPaused = String(reduce.matches || !config.active);
    if (reduce.matches || !config.active) staticFrame();
    else if (canAnimate()) { render(); raf = win.requestAnimationFrame(tick); }
  }
  const observer = typeof win.IntersectionObserver === 'function' ? new win.IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? true; wake(); }) : null;
  observer?.observe(svg);
  function look(event: PointerEvent) {
    if (!config.interactive || !canAnimate() || config.state !== 'idle') return;
    since = time;
    const box = svg.getBoundingClientRect();
    engine.setLook(pointerLook(event.clientX, event.clientY, box), time);
  }
  const leave = () => engine.setLook(null, time);
  const poke = () => { if (config.interactive && config.state === 'idle') { since = time; pokeUntil = time + 1.6; } };
  svg.addEventListener('pointermove', look); svg.addEventListener('pointerleave', leave); svg.addEventListener('pointerdown', poke);
  doc.addEventListener('visibilitychange', wake); reduce.addEventListener('change', wake);
  staticFrame(); wake();
  return {
    update(next: MotionOptions) {
      const previous = config;
      config = { ...config, ...next };
      if (next.restart || config.state !== previous.state || config.motion !== previous.motion) { since = time; pokeUntil = 0; engine.setLook(null, time); }
      svg.dataset.state = config.state;
      wake();
    },
    dispose() {
      disposed = true; win.cancelAnimationFrame(raf); observer?.disconnect();
      doc.removeEventListener('visibilitychange', wake); reduce.removeEventListener('change', wake);
      svg.removeEventListener('pointermove', look); svg.removeEventListener('pointerleave', leave); svg.removeEventListener('pointerdown', poke);
    },
  };
}
