export type Rgba = { r: number; g: number; b: number; a: number };

export type ColorDraft = {
  rgba: Rgba;
  h: number;
  s: number;
  v: number;
  transparent: boolean;
};

export type ColorDraftAction =
  | { type: 'channel'; channel: keyof Rgba; value: number }
  | { type: 'rgba'; rgba: Rgba }
  | { type: 'preset'; hex: string }
  | { type: 'hue'; h: number }
  | { type: 'sv'; s: number; v: number }
  | { type: 'transparent' };

export const COLOR_PRESETS = [
  '#D0021B',
  '#F5A623',
  '#F8E71C',
  '#8B572A',
  '#7ED321',
  '#417505',
  '#BD10E0',
  '#9013FE',
  '#4A90E2',
  '#50E3C2',
  '#B8E986',
  '#000000',
  '#4A4A4A',
  '#9B9B9B',
  '#FFFFFF',
];

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

const hexPair = (n: number) => Math.round(n).toString(16).padStart(2, '0');

export function parseColor(value: string): Rgba | null {
  const text = value.trim().toLowerCase();
  if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
    const [r, g, b, a = 255] = (full.match(/../g) ?? []).map((p) =>
      parseInt(p, 16)
    );
    return { r, g, b, a: Math.round((a / 255) * 100) };
  }

  const fn =
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(
      text
    );
  if (!fn) return null;

  return {
    r: clamp(Number(fn[1]), 0, 255),
    g: clamp(Number(fn[2]), 0, 255),
    b: clamp(Number(fn[3]), 0, 255),
    a: fn[4] === undefined ? 100 : Math.round(clamp(Number(fn[4]), 0, 1) * 100),
  };
}

export function rgbaToHex({ r, g, b, a }: Rgba) {
  const rgb = `#${hexPair(r)}${hexPair(g)}${hexPair(b)}`;
  return a >= 100 ? rgb : `${rgb}${hexPair((a / 100) * 255)}`;
}

export function parseHexInput(text: string, alpha: number): Rgba | null {
  const hex = text.trim().replace(/^#/, '');
  if (hex.length !== 3 && hex.length !== 6) return null;
  const rgba = parseColor(`#${hex}`);

  return rgba && { ...rgba, a: alpha };
}

export function rgbToHsv({ r, g, b }: Rgba) {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const d = max - Math.min(rn, gn, bn);
  let h = 0;
  if (d) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
  }

  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

export function hsvToRgb(h: number, s: number, v: number) {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };

  return { r: f(5), g: f(3), b: f(1) };
}

const fromRgba = (rgba: Rgba, keepHue?: number): ColorDraft => {
  const hsv = rgbToHsv(rgba);
  const h = hsv.s === 0 && keepHue !== undefined ? keepHue : hsv.h;

  return { rgba, h, s: hsv.s, v: hsv.v, transparent: false };
};

export function initColorDraft(value: string): ColorDraft {
  const draft = fromRgba(parseColor(value) ?? { r: 0, g: 0, b: 0, a: 100 });

  return {
    ...draft,
    transparent: value.trim().toLowerCase() === 'transparent',
  };
}

export function colorDraftReducer(
  draft: ColorDraft,
  action: ColorDraftAction
): ColorDraft {
  switch (action.type) {
    case 'channel': {
      const max = action.channel === 'a' ? 100 : 255;
      const rgba = {
        ...draft.rgba,
        [action.channel]: Math.round(clamp(action.value, 0, max)),
      };
      return fromRgba(rgba, draft.h);
    }
    case 'rgba':
      return fromRgba(action.rgba, draft.h);
    case 'preset': {
      const rgb = parseColor(action.hex);
      return rgb ? fromRgba({ ...rgb, a: draft.rgba.a }, draft.h) : draft;
    }
    case 'hue':
      return {
        ...draft,
        h: action.h,
        rgba: { ...draft.rgba, ...hsvToRgb(action.h, draft.s, draft.v) },
        transparent: false,
      };
    case 'sv':
      return {
        ...draft,
        s: action.s,
        v: action.v,
        rgba: { ...draft.rgba, ...hsvToRgb(draft.h, action.s, action.v) },
        transparent: false,
      };
    case 'transparent':
      return { ...draft, rgba: { ...draft.rgba, a: 0 }, transparent: true };
  }
}

export function draftToValue(
  draft: ColorDraft,
  transparentValue = 'transparent'
) {
  return draft.transparent ? transparentValue : rgbaToHex(draft.rgba);
}
