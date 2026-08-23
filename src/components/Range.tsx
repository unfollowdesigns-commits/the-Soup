import { useCallback, useId, useRef, useState, type PointerEvent as RP } from 'react';

/* ============================================================
   RANGE
   The lab had native <input type="range"> in three places. A
   browser slider is the one control on a screen that is not
   yours: it carries the operating system's chrome into a room
   that is meant to be black, and it is the reason a page reads
   as unfinished no matter what is round it.

   This is the same behaviour, drawn: a hairline track, a filled
   run, a machined handle, and a value you can actually read.
   Shift drags ten times finer. Arrow keys step.
   ============================================================ */

export function Range({
  value,
  onChange,
  onCommit,
  min = 0,
  max = 1,
  step = 0.01,
  label,
  format,
  unit,
  disabled = false,
  size = 'normal',
  ticks = 0,
}: {
  value: number;
  onChange: (v: number) => void;
  onCommit?: () => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  format?: (v: number) => string;
  unit?: string;
  disabled?: boolean;
  /** 'tight' for a card, 'normal' for a bench, 'loud' when it is the
      only thing on the screen */
  size?: 'tight' | 'normal' | 'loud';
  ticks?: number;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const id = useId();
  const t = (value - min) / (max - min);

  const quant = useCallback(
    (raw: number, fine: boolean) => {
      const s = fine ? step / 10 : step;
      const v = Math.round(raw / s) * s;
      return Math.min(max, Math.max(min, +v.toFixed(6)));
    },
    [min, max, step],
  );

  const fromX = useCallback(
    (clientX: number, fine: boolean) => {
      const el = track.current;
      if (!el) return value;
      const r = el.getBoundingClientRect();
      return quant(min + ((clientX - r.left) / r.width) * (max - min), fine);
    },
    [min, max, quant, value],
  );

  const down = (e: RP<HTMLDivElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    onChange(fromX(e.clientX, e.shiftKey));
  };
  const move = (e: RP<HTMLDivElement>) => {
    if (!dragging || disabled) return;
    onChange(fromX(e.clientX, e.shiftKey));
  };
  const up = (e: RP<HTMLDivElement>) => {
    if (!dragging) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
    onCommit?.();
  };

  const key = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const s = e.shiftKey ? step * 10 : step;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onChange(quant(value + s, false)); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onChange(quant(value - s, false)); }
    if (e.key === 'Home') { e.preventDefault(); onChange(min); }
    if (e.key === 'End') { e.preventDefault(); onChange(max); }
  };

  const shown = format ? format(value) : value.toFixed(2);

  return (
    <div className="rng" data-size={size} data-dragging={dragging} data-off={disabled}>
      {label || size !== 'tight' ? (
        <div className="rng__head">
          {label ? <span className="rng__label" id={`${id}-l`}>{label}</span> : null}
          <span className="rng__value">
            {shown}
            {unit ? <span className="rng__unit">{unit}</span> : null}
          </span>
        </div>
      ) : null}

      <div
        ref={track}
        className="rng__track"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-labelledby={label ? `${id}-l` : undefined}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={shown}
        aria-disabled={disabled}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
      >
        {ticks > 1 ? (
          <div className="rng__ticks" aria-hidden="true">
            {Array.from({ length: ticks }, (_, i) => (
              <i key={i} data-major={i === 0 || i === ticks - 1 || i === (ticks - 1) / 2} />
            ))}
          </div>
        ) : null}
        <div className="rng__rail" />
        <div className="rng__fill" style={{ width: `${Math.max(0, Math.min(1, t)) * 100}%` }} />
        <div className="rng__handle" style={{ left: `${Math.max(0, Math.min(1, t)) * 100}%` }}>
          <i />
        </div>
      </div>
    </div>
  );
}
