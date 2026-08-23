import { useCallback, useId, useRef, useState, type PointerEvent as RP } from 'react';

/* ============================================================
   DIAL
   A knob, because a darkroom timer is a knob and because a
   screen made entirely of rectangles reads as a form.

   It is dragged the way a real one is — up and round, not
   sideways — and the arc it fills is the value. The number sits
   inside it, large, because the number is the thing you are
   reading while you turn it.
   ============================================================ */

const SWEEP = 280;                       /* degrees of travel */
const START = 90 + (360 - SWEEP) / 2;    /* leaves a gap at the bottom */

const polar = (cx: number, cy: number, r: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
};

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const [x0, y0] = polar(cx, cy, r, from);
  const [x1, y1] = polar(cx, cy, r, to);
  const big = to - from > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${big} 1 ${x1} ${y1}`;
}

export function Dial({
  value,
  onChange,
  onCommit,
  label,
  caption,
  format,
  disabled = false,
  size = 132,
}: {
  value: number;
  onChange: (v: number) => void;
  onCommit?: () => void;
  label?: string;
  caption?: string;
  format?: (v: number) => string;
  disabled?: boolean;
  size?: number;
}) {
  const [dragging, setDragging] = useState(false);
  const from = useRef({ y: 0, v: 0 });
  const id = useId();
  const v = Math.max(0, Math.min(1, value));

  const set = useCallback(
    (next: number) => onChange(Math.max(0, Math.min(1, +next.toFixed(4)))),
    [onChange],
  );

  const down = (e: RP<HTMLDivElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    from.current = { y: e.clientY, v };
    setDragging(true);
  };
  const move = (e: RP<HTMLDivElement>) => {
    if (!dragging || disabled) return;
    // 180px of travel is the whole range; shift makes it ten times finer
    const span = e.shiftKey ? 1800 : 180;
    set(from.current.v + (from.current.y - e.clientY) / span);
  };
  const up = (e: RP<HTMLDivElement>) => {
    if (!dragging) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
    onCommit?.();
  };
  const key = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const s = e.shiftKey ? 0.1 : 0.01;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); set(v + s); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); set(v - s); }
    if (e.key === 'Home') { e.preventDefault(); set(0); }
    if (e.key === 'End') { e.preventDefault(); set(1); }
  };

  const c = size / 2;
  const r = c - 9;
  const end = START + SWEEP * v;
  const [tx, ty] = polar(c, c, r - 13, end);
  const [hx, hy] = polar(c, c, r - 3, end);
  const shown = format ? format(value) : `${Math.round(v * 100)}`;

  return (
    <div className="dial" data-dragging={dragging} data-off={disabled}>
      <div
        className="dial__knob"
        style={{ width: size, height: size }}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-labelledby={label ? `${id}-l` : undefined}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={v}
        aria-valuetext={shown}
        aria-disabled={disabled}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          {/* the scale it turns against */}
          {Array.from({ length: 21 }, (_, i) => {
            const deg = START + (SWEEP * i) / 20;
            const major = i % 5 === 0;
            const [x0, y0] = polar(c, c, r + 1, deg);
            const [x1, y1] = polar(c, c, r + (major ? 6 : 4), deg);
            return (
              <line
                key={i} x1={x0} y1={y0} x2={x1} y2={y1}
                className={major ? 'dial__tick dial__tick--major' : 'dial__tick'}
              />
            );
          })}
          <path d={arc(c, c, r, START, START + SWEEP)} className="dial__rail" />
          {v > 0.001 ? <path d={arc(c, c, r, START, end)} className="dial__fill" /> : null}
          <circle cx={c} cy={c} r={r - 12} className="dial__face" />
          <line x1={tx} y1={ty} x2={hx} y2={hy} className="dial__hand" />
        </svg>
        <span className="dial__read">{shown}</span>
      </div>

      {label ? (
        <div className="dial__legend">
          <span className="dial__label" id={`${id}-l`}>{label}</span>
          {caption ? <span className="dial__caption">{caption}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/* ============================================================
   SWITCH
   A checkbox is the browser's, not ours, and it is the other
   thing on a page that gives away that nobody drew it.
   ============================================================ */

export function Switch({
  on,
  onChange,
  label,
  note,
  disabled = false,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  note?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="swt"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <span className="swt__track" aria-hidden="true"><i /></span>
      <span className="swt__text">
        <span className="swt__label">{label}</span>
        {note ? <span className="swt__note">{note}</span> : null}
      </span>
    </button>
  );
}
