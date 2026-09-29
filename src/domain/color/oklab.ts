/**
 * sRGB <-> OKLab <-> OKLCh, hand-rolled.
 *
 * WHY OKLCh AND NOT HSL OR CIELAB
 *
 * HSL is disqualified outright: #0000FF and #FFFF00 both have HSL lightness
 * 50%, so any "keep the lightness close" or "low contrast reads as soft" rule
 * is meaningless in it.
 *
 * CIELAB is perceptually reasonable but has a well-known hue non-uniformity in
 * the blue region — hue drifts toward purple as chroma rises. That breaks an
 * "analogous within +/-30 degrees" rule exactly where navy and indigo denim
 * live, and denim is the single most common garment colour there is.
 *
 * OKLab was designed to fix blue hue-linearity, and it is pure arithmetic with
 * no lookup tables — about sixty lines — so vendoring it removes a runtime
 * dependency and a Metro resolution risk entirely. culori is kept as a
 * dev-only dependency purely to validate these conversions in the tests.
 *
 * Reference: Björn Ottosson, "A perceptual color space for image processing".
 */

export interface Oklch {
  /** Perceptual lightness, 0..1. */
  l: number;
  /** Chroma, 0..~0.4 in sRGB. Below ~0.06 reads as neutral. */
  c: number;
  /** Hue angle in degrees, 0..360. Meaningless when c is ~0. */
  h: number;
}

export interface Oklab {
  l: number;
  a: number;
  b: number;
}

export interface Rgb {
  /** 0..255 */
  r: number;
  g: number;
  b: number;
}

/** Chroma below this reads as a neutral — black, white, grey, most denim-free basics. */
export const NEUTRAL_CHROMA = 0.06;

/**
 * Clamp to [0, 1], sending NaN to 0.
 *
 * Written `v > 0 ? ... : 0` rather than `v < 0 ? 0 : ...` on purpose: every
 * comparison with NaN is false, so the usual form returned NaN untouched, and
 * one NaN anywhere reached a sort comparator and made the ranking undefined.
 * This is the only copy; there used to be three.
 */
export const clamp01 = (v: number): number => (v > 0 ? (v < 1 ? v : 1) : 0);

/** sRGB electro-optical transfer function, 0..1 -> linear light. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Inverse transfer, linear light -> 0..1 sRGB. */
export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function rgbToOklab({ r, g, b }: Rgb): Oklab {
  const lr = srgbToLinear(r / 255);
  const lg = srgbToLinear(g / 255);
  const lb = srgbToLinear(b / 255);

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return {
    l: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

export function oklabToRgb({ l, a, b }: Oklab): Rgb {
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const L = l_ * l_ * l_;
  const M = m_ * m_ * m_;
  const S = s_ * s_ * s_;

  const lr = 4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S;
  const lg = -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S;
  const lb = -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S;

  return {
    r: Math.round(255 * clamp01(linearToSrgb(lr))),
    g: Math.round(255 * clamp01(linearToSrgb(lg))),
    b: Math.round(255 * clamp01(linearToSrgb(lb))),
  };
}

export function oklabToOklch({ l, a, b }: Oklab): Oklch {
  const c = Math.sqrt(a * a + b * b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l, c, h };
}

export function oklchToOklab({ l, c, h }: Oklch): Oklab {
  const rad = (h * Math.PI) / 180;
  return { l, a: c * Math.cos(rad), b: c * Math.sin(rad) };
}

export const rgbToOklch = (rgb: Rgb): Oklch => oklabToOklch(rgbToOklab(rgb));
export const oklchToRgb = (lch: Oklch): Rgb => oklabToRgb(oklchToOklab(lch));

export function hexToRgb(hex: string): Rgb {
  const s = hex.replace('#', '');
  const full =
    s.length === 3
      ? s
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : s;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Euclidean distance in OKLab. Perceptually uniform, so a single threshold works. */
export function oklabDistance(a: Oklab, b: Oklab): number {
  const dl = a.l - b.l;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return Math.sqrt(dl * dl + da * da + db * db);
}

/** Shortest angular distance between two hues, 0..180 degrees. */
export function hueDistance(h1: number, h2: number): number {
  const d = Math.abs(((h1 - h2) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

/** Chroma so low that hue carries no meaning — treat as a neutral that goes with anything. */
export function isNeutral(c: Oklch): boolean {
  return c.c < NEUTRAL_CHROMA;
}
