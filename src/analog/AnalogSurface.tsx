import {
  useId,
  useMemo,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from 'react';
import {
  ATLAS_SLOT,
  ATLAS_URL,
  TEXTURE_URL,
  flickerKeyframes,
  jitterKeyframes,
  placement,
  resolveAnalog,
  type AnalogConfig,
  type AnalogPreset,
} from './analog';
import './analog.css';

export interface AnalogSurfaceProps extends Partial<AnalogConfig> {
  preset?: AnalogPreset;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  /** put the material behind the content instead of over it */
  behind?: boolean;
}

/* ============================================================
   <AnalogSurface>
   Wraps anything in a composable stack of analog material.
   Layers are only mounted when their control is above zero, so an
   unused effect costs nothing.
   ============================================================ */
export function AnalogSurface({
  preset,
  as: Tag = 'div',
  className = '',
  style,
  children,
  behind = false,
  ...over
}: AnalogSurfaceProps) {
  const cfg = resolveAnalog(preset, over);
  const uid = useId().replace(/:/g, '');

  const { layers, keyframes, wrapStyle } = useMemo(() => {
    const layers: { key: string; style: CSSProperties; cls: string }[] = [];
    const kf: string[] = [];

    const mark = (
      key: string,
      slot: keyof typeof ATLAS_SLOT,
      amount: number,
      blend: string,
      salt: number,
      variant: 1 | 2 = 1,
    ) => {
      const p = placement(cfg.seed, salt);
      layers.push({
        key,
        cls: `analog__layer analog__layer--mark`,
        style: {
          backgroundImage: `url(${ATLAS_URL(variant)})`,
          backgroundPosition: ATLAS_SLOT[slot],
          backgroundSize: `${p.scale * 200}% ${p.scale * 200}%`,
          opacity: amount,
          mixBlendMode: blend as CSSProperties['mixBlendMode'],
          transform: `rotate(${p.rotate}deg) scale(${p.flip ? -1 : 1}, 1)`,
        },
      });
    };

    /* --- REAL MATERIAL ------------------------------------- */
    if (cfg.texture !== 'none' && cfg.textureOpacity > 0) {
      const urls = TEXTURE_URL[cfg.texture];
      const pick = urls[cfg.seed % urls.length];
      layers.push({
        key: 'texture',
        cls: 'analog__layer analog__layer--texture',
        style: {
          backgroundImage: `url(${import.meta.env.BASE_URL}${pick})`,
          backgroundSize: cfg.texture === 'paper' ? '420px 420px' : '620px 620px',
          opacity: cfg.textureOpacity,
        },
      });
    }
    if (cfg.dust > 0) {
      mark('dust', 'dust', cfg.dust * 0.5, 'multiply', 3);
      mark('hair', 'hair', cfg.dust * 0.42, 'multiply', 11, 2);
    }
    if (cfg.scratches > 0) {
      mark('scratch', 'scratches', cfg.scratches * 0.44, 'screen', 23);
    }

    /* --- PROCEDURAL ---------------------------------------- */
    if (cfg.grain > 0) {
      layers.push({
        key: 'grain',
        cls: 'analog__layer analog__layer--grain',
        style: {
          opacity: cfg.grain * 0.5,
          filter: `url(#analog-grain-${uid})`,
        },
      });
    }
    if (cfg.burn > 0) {
      const p = placement(cfg.seed, 41);
      layers.push({
        key: 'burn',
        cls: 'analog__layer analog__layer--burn',
        style: {
          opacity: cfg.burn,
          // the ember, shaped by a real stain so the edge is not a circle
          backgroundImage: `radial-gradient(60% 70% at ${p.x}% ${p.y}%,
            rgba(255,244,228,0.95) 0%,
            rgba(226,126,44,0.85) 22%,
            rgba(148,52,22,0.6) 40%,
            rgba(28,14,8,0.55) 56%,
            rgba(0,0,0,0) 76%)`,
          maskImage: `url(${ATLAS_URL(2)})`,
          maskPosition: ATLAS_SLOT.stain,
          maskSize: `${p.scale * 200}% ${p.scale * 200}%`,
          WebkitMaskImage: `url(${ATLAS_URL(2)})`,
          WebkitMaskPosition: ATLAS_SLOT.stain,
          WebkitMaskSize: `${p.scale * 200}% ${p.scale * 200}%`,
        },
      });
    }

    /* --- MOTION -------------------------------------------- */
    const wrapStyle: CSSProperties = { ...style };
    const anims: string[] = [];
    if (cfg.flicker > 0) {
      kf.push(`@keyframes analog-flicker-${uid}{${flickerKeyframes(cfg.seed, cfg.flicker)}}`);
      anims.push(`analog-flicker-${uid} ${(2.4 + (cfg.seed % 7) * 0.3).toFixed(1)}s steps(1,end) infinite`);
    }
    if (cfg.jitter > 0) {
      kf.push(`@keyframes analog-jitter-${uid}{${jitterKeyframes(cfg.seed, cfg.jitter)}}`);
      anims.push(`analog-jitter-${uid} ${(1.7 + (cfg.seed % 5) * 0.22).toFixed(1)}s steps(1,end) infinite`);
    }
    if (anims.length) wrapStyle.animation = anims.join(', ');
    if (cfg.halation > 0 || cfg.displace > 0) {
      const f: string[] = [];
      if (cfg.displace > 0) f.push(`url(#analog-displace-${uid})`);
      if (cfg.halation > 0) f.push(`url(#analog-halation-${uid})`);
      wrapStyle.filter = f.join(' ');
    }

    return { layers, keyframes: kf.join('\n'), wrapStyle };
  }, [cfg, style, uid]);

  const needsDefs = cfg.grain > 0 || cfg.halation > 0 || cfg.displace > 0;

  return (
    <Tag
      className={`analog ${behind ? 'analog--behind' : ''} ${className}`}
      style={wrapStyle}
      data-analog={preset ?? 'custom'}
    >
      {keyframes ? <style>{keyframes}</style> : null}
      {needsDefs ? <AnalogFilters uid={uid} cfg={cfg} /> : null}
      {children}
      <div className="analog__stack" aria-hidden="true">
        {layers.map((l) => (
          <span key={l.key} className={l.cls} style={l.style} />
        ))}
      </div>
    </Tag>
  );
}

/* ------------------------------------------------------------
   Filter primitives. Generated per element, so the noise field is
   never the same twice and never tiles.
   ------------------------------------------------------------ */
function AnalogFilters({ uid, cfg }: { uid: string; cfg: AnalogConfig }) {
  return (
    <svg className="analog__defs" aria-hidden="true" focusable="false">
      <defs>
        {cfg.grain > 0 && (
          <filter id={`analog-grain-${uid}`} x="0" y="0" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency={0.62 + cfg.grain * 0.3}
              numOctaves={3}
              seed={cfg.seed % 9999}
              stitchTiles="noStitch"
              result="n"
            />
            {/* Map the turbulence to a grey that sits either side of the
                overlay neutral, with a solid alpha. Modulating alpha instead
                leaves a visible plate over the surface. */}
            <feColorMatrix
              in="n"
              type="matrix"
              values="0.2 0.2 0.2 0 0.2  0.2 0.2 0.2 0 0.2  0.2 0.2 0.2 0 0.2  0 0 0 0 1"
            />
          </filter>
        )}
        {cfg.displace > 0 && (
          <filter id={`analog-displace-${uid}`} x="-4%" y="-4%" width="108%" height="108%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency={0.006 + cfg.displace * 0.008}
              numOctaves={2}
              seed={(cfg.seed * 7) % 9999}
              result="warp"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="warp"
              scale={cfg.displace * 5}
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        )}
        {cfg.halation > 0 && (
          <filter id={`analog-halation-${uid}`} x="-8%" y="-8%" width="116%" height="116%">
            {/* isolate the highlights, scatter them, put them back warm */}
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="0.33 0.33 0.33 0 -0.52  0.33 0.33 0.33 0 -0.52  0.33 0.33 0.33 0 -0.52  0 0 0 1 0"
              result="hi"
            />
            <feGaussianBlur in="hi" stdDeviation={2 + cfg.halation * 10} result="scatter" />
            <feColorMatrix
              in="scatter"
              type="matrix"
              values={`${1.6 * cfg.halation} 0 0 0 0  ${0.5 * cfg.halation} 0 0 0 0  ${0.22 * cfg.halation} 0 0 0 0  0 0 0 1 0`}
              result="warm"
            />
            <feComposite in="warm" in2="SourceGraphic" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" />
          </filter>
        )}
      </defs>
    </svg>
  );
}
