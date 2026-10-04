import { ExpressiveOrb, type ExpressiveOrbMood } from './ExpressiveOrb';
import type { CompanionState } from './bloub-motion';
export type OrbCompanionState = CompanionState;
export function OrbCompanion({ state = 'idle', size = 64, mood, label }: { state?: CompanionState; size?: number; mood?: ExpressiveOrbMood; label?: string }) {
  return <span className={`orb-companion orb-companion--${state}`} data-state={state} role={label ? 'img' : 'presentation'} aria-label={label} style={{ width: size, height: Math.round(size * 1.22) }}>
    <span className="orb-companion__orb"><ExpressiveOrb state={state} mood={mood} size={size} active={size >= 44 || state !== 'idle'} /></span>
      <svg aria-hidden="true" className="orb-companion__laptop" viewBox="24 10 72 54">
        <ellipse className="companion-shadow" cx="60" cy="58" fill="rgba(46,26,10,0.15)" rx="36" ry="3.6" />
        <g className="companion-laptop">
          <rect className="companion-laptop__screen" fill="#4A3826" height="37" rx="5" width="54" x="33" y="11" />
          <rect fill="#2E2318" height="30" rx="3" width="48" x="36" y="14.5" />
          <g className="companion-laptop__glyphs" fill="#FFE7C2">
            <rect className="companion-glyph" height="2.8" rx="1.4" width="11" x="40" y="20" />
            <rect className="companion-glyph" height="2.8" rx="1.4" width="16" x="40" y="26.5" />
            <rect className="companion-glyph" height="2.8" rx="1.4" width="7" x="40" y="33" />
            <rect className="companion-glyph" height="2.8" rx="1.4" width="12" x="60" y="26.5" />
            <rect className="companion-glyph" height="2.8" rx="1.4" width="8" x="60" y="33" />
          </g>
          {/* 键盘底座 */}
          <path d="M26 52.5 L94 52.5 L87 49.5 L33 49.5 Z" fill="#6B4E33" />
          <rect fill="#7A5C3E" height="3.6" rx="1.8" width="70" x="25" y="51.1" />
        </g>
      </svg>
  </span>;
}
