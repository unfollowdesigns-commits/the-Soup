/* ============================================================
   THE MARK
   A halftone ramp: an 8 x 8 field of dots growing from nothing to
   solid. It is the product in one shape — a picture becoming a
   material. Reads as a gradient square at 16px and as a screen at
   200px, which is the only test a mark has to pass.
   ============================================================ */

export function Mark({
  size = 24,
  className,
  tone = 'currentColor',
}: {
  size?: number;
  className?: string;
  tone?: string;
}) {
  const N = 8;
  const cells: React.ReactNode[] = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      // radius grows along the diagonal, so the ramp reads at any size
      const t = (x + y) / (2 * (N - 1));
      const r = 0.06 + t * 0.46;
      cells.push(
        <circle key={`${x}-${y}`} cx={x + 0.5} cy={y + 0.5} r={r} fill={tone} />,
      );
    }
  }
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${N} ${N}`}
      aria-hidden="true"
      shapeRendering="geometricPrecision"
    >
      {cells}
    </svg>
  );
}

/* ------------------------------------------------------------
   THE WORDMARK
   Set tight and heavy. The mark sits on the baseline, not beside
   the type as an afterthought.
   ------------------------------------------------------------ */
export function Wordmark({
  size = 20,
  showMark = true,
  className = '',
}: {
  size?: number;
  showMark?: boolean;
  className?: string;
}) {
  return (
    <span className={`wordmark ${className}`} style={{ fontSize: size }}>
      {showMark ? <Mark size={size * 0.92} className="wordmark__mark" /> : null}
      <span className="wordmark__type">
        SOUP
      </span>
    </span>
  );
}
