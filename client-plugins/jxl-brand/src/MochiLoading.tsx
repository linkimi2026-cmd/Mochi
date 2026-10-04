import { OrbCompanion } from "./OrbCompanion";
import "./MochiLoading.css";

/** Shared running indicator for the boot page and the active chat turn. */
export function MochiLoading({ text = "Mochi 正在准备", compact = false }: { text?: string; compact?: boolean }) {
  return <span className={`mochi-loading${compact ? " mochi-loading--compact" : ""}`} role="status" aria-label={text}>
    <span className="mochi-loading__character" aria-hidden="true">
      <OrbCompanion state={compact ? "thinking" : "boot"} size={64} />
    </span>
    {!compact && <span className="mochi-loading__text">{text}</span>}
  </span>;
}
