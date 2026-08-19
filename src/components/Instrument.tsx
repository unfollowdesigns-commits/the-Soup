import {
  useCallback,
  useId,
  useRef,
  useState,
  type PointerEvent as RPointerEvent,
  type ReactNode,
} from 'react';

/* ============================================================
   INSTRUMENT CONTROLS
   Not general-purpose sliders. These read like the scales on a
   meter or an enlarger timer: a fixed travel, tick marks, and a
   number you can actually trust.
   ============================================================ */

export interface InstrumentProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  /** draw the travel from the centre outward */
  bipolar?: boolean;
  /** printed to the right of the label */
  format?: (v: number) => string;
  unit?: string;
  ticks?: number;
  disabled?: boolean;
  note?: string;
  onChange: (v: number) => void;
  onCommit?: () => void;
}

export function Instrument({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  bipolar = false,
  format,
  unit,
  ticks = 9,
  disabled = false,
  note,
  onChange,
  onCommit,
}: InstrumentProps) {
  const track = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const id = useId();

  const t = (value - min) / (max - min);
  const zero = bipolar ? (0 - min) / (max - min) : 0;

  const quant = useCallback(
    (raw: number, fine: boolean) => {
      const s = fine ? step / 10 : step;
      const v = Math.round(raw / s) * s;
      return Math.min(max, Math.max(min, +v.toFixed(6)));
    },
    [min, max, step],
  );

  const fromEvent = useCallback(
    (clientX: number, fine: boolean) => {
      const el = track.current;
      if (!el) return value;
      const r = el.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      return quant(min + p * (max - min), fine);
    },
    [min, max, quant, value],
  );

  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
    onChange(fromEvent(e.clientX, e.shiftKey));
  };

  const move = (e: RPointerEvent<HTMLDivElement>) => {
    if (!dragging || disabled) return;
    onChange(fromEvent(e.clientX, e.shiftKey));
  };

  const up = (e: RPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    setDragging(false);
    onCommit?.();
  };

  const key = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const s = e.shiftKey ? step * 10 : step;
    let v = value;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v = quant(value + s, false);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v = quant(value - s, false);
    else if (e.key === 'Home') v = min;
    else if (e.key === 'End') v = max;
    else return;
    e.preventDefault();
    onChange(v);
    onCommit?.();
  };

  const printed = format ? format(value) : value.toFixed(2);

  return (
    <div className={`instr ${disabled ? 'instr--off' : ''}`} data-dragging={dragging}>
      <div className="instr__head">
        <span className="instr__label" id={id}>{label}</span>
        <span className="instr__value mono">
          {printed}
          {unit ? <span className="instr__unit">{unit}</span> : null}
        </span>
      </div>
      <div
        ref={track}
        className="instr__track"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-labelledby={id}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={printed}
        aria-disabled={disabled}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
        onDoubleClick={() => {
          if (disabled) return;
          onChange(bipolar ? 0 : min);
          onCommit?.();
        }}
      >
        <div className="instr__ticks" aria-hidden="true">
          {Array.from({ length: ticks }, (_, i) => (
            <span
              key={i}
              className="instr__tick"
              data-major={i === 0 || i === ticks - 1 || (bipolar && i === (ticks - 1) / 2)}
            />
          ))}
        </div>
        <div className="instr__rail" />
        <div
          className="instr__fill"
          style={
            bipolar
              ? { left: `${Math.min(t, zero) * 100}%`, width: `${Math.abs(t - zero) * 100}%` }
              : { left: 0, width: `${t * 100}%` }
          }
        />
        <div className="instr__handle" style={{ left: `${t * 100}%` }}>
          <span className="instr__handle-line" />
        </div>
      </div>
      {note ? <p className="instr__note">{note}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------
   EXPOSURE SCALE — the one control that gets its own instrument
   ------------------------------------------------------------ */
export function ExposureScale({
  value,
  onChange,
  onCommit,
}: {
  value: number;
  onChange: (v: number) => void;
  onCommit?: () => void;
}) {
  const stops = [-3, -2, -1, 0, 1, 2, 3];
  return (
    <div className="expscale">
      <div className="expscale__stops" aria-hidden="true">
        {stops.map((s) => (
          <span key={s} className="expscale__stop" data-zero={s === 0}>
            {s > 0 ? `+${s}` : s}
          </span>
        ))}
      </div>
      <Instrument
        label="Exposure"
        value={value}
        min={-3}
        max={3}
        step={0.1}
        bipolar
        ticks={25}
        unit=" EV"
        format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`}
        onChange={onChange}
        onCommit={onCommit}
      />
    </div>
  );
}

/* ------------------------------------------------------------
   MODULE — a labelled block in the workstation
   ------------------------------------------------------------ */
export function Module({
  title,
  meta,
  children,
  open = true,
  onToggle,
  enabled = true,
  onEnabled,
  accent,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  open?: boolean;
  onToggle?: () => void;
  enabled?: boolean;
  onEnabled?: () => void;
  accent?: 'amber' | 'red' | 'chem' | 'blue';
}) {
  return (
    <section className="mod" data-open={open} data-enabled={enabled} data-accent={accent}>
      <header className="mod__head">
        <button
          className="mod__title"
          onClick={onToggle}
          aria-expanded={open}
          type="button"
        >
          <Chevron open={open} />
          <span className="lbl lbl--lit">{title}</span>
        </button>
        <span className="mod__meta mono mono--dim">{meta}</span>
        {onEnabled ? (
          <button
            className="mod__power"
            onClick={onEnabled}
            aria-pressed={enabled}
            title={enabled ? 'Disable stage' : 'Enable stage'}
            type="button"
          >
            <span className="lamp" data-state={enabled ? 'on' : 'off'} />
          </button>
        ) : null}
      </header>
      {open ? <div className="mod__body">{children}</div> : null}
    </section>
  );
}

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg className="chev" data-open={open} width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
      <path d="M2 1.2 L5.6 4 L2 6.8" fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

/* ------------------------------------------------------------
   SEGMENTED SELECTOR
   ------------------------------------------------------------ */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { id: T; label: string; title?: string }[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="segrow">
      {label ? <span className="instr__label">{label}</span> : null}
      <div className="seg" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className="seg__opt"
            aria-pressed={o.id === value}
            title={o.title}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------
   SEED FIELD — reproducibility, made visible
   ------------------------------------------------------------ */
export function SeedField({
  seed,
  onSeed,
  label = 'Seed',
}: {
  seed: number;
  onSeed: (s: number) => void;
  label?: string;
}) {
  return (
    <div className="seedfield">
      <span className="instr__label">{label}</span>
      <span className="mono mono--val">{seed.toString(16).toUpperCase().padStart(5, '0')}</span>
      <button
        className="btn btn--sm btn--quiet"
        type="button"
        onClick={() => onSeed(Math.floor(Math.random() * 0xfffff))}
      >
        New
      </button>
    </div>
  );
}

/* ------------------------------------------------------------
   TRAIT BAR — the archive's shorthand for a material's character
   ------------------------------------------------------------ */
export function TraitBar({ label, value }: { label: string; value: number }) {
  const filled = Math.round(value * 10);
  return (
    <div className="trait">
      <span className="trait__label">{label}</span>
      <span className="trait__bar" aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => (
          <i key={i} data-on={i < filled} />
        ))}
      </span>
      <span className="sr">{Math.round(value * 100)} of 100</span>
    </div>
  );
}
