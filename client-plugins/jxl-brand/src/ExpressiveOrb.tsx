import { useEffect, useRef } from 'react';
import { mountMotion, type CompanionState, type MochiMotion } from './bloub-motion';
export type { MochiMotion } from './bloub-motion';
export type ExpressiveOrbMood = 'idle' | 'thinking' | 'listening' | 'speaking' | 'success' | 'alert';
const moodState: Record<ExpressiveOrbMood, CompanionState> = { idle: 'idle', thinking: 'thinking', listening: 'listening', speaking: 'speaking', success: 'celebrate', alert: 'alert' };

type Props = { size?: number; mood?: ExpressiveOrbMood; state?: CompanionState; motion?: MochiMotion; active?: boolean; interactive?: boolean; label?: string; className?: string };
/** React owns the seat; the shared bloub adapter owns only the SVG contents. */
export function ExpressiveOrb({ size = 48, mood = 'idle', state, motion, active = true, interactive = true, label, className = '' }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const controller = useRef<ReturnType<typeof mountMotion> | null>(null);
  useEffect(() => {
    if (!svg.current) return;
    const instance = mountMotion(svg.current, { state: state ?? moodState[mood], motion, active, interactive });
    controller.current = instance;
    return () => { instance.dispose(); controller.current = null; };
  }, []);
  useEffect(() => { controller.current?.update({ state: state ?? moodState[mood], motion, active, interactive }); }, [state, mood, motion, active, interactive]);
  return <span className={`expressive-orb ${className}`} style={{ width: size, height: size }} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} data-still={!active}>
    <svg ref={svg} className="expressive-orb__svg" viewBox="-158 -158 316 316" aria-hidden="true" focusable="false">
      <circle r="100" fill="#a06a32" /><g fill="#fff6e6"><ellipse cx="-22" cy="4" rx="11" ry="15" /><ellipse cx="22" cy="4" rx="11" ry="15" /></g>
    </svg>
  </span>;
}
