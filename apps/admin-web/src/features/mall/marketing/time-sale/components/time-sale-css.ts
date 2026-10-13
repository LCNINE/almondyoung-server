import type { SaleCss } from '@packages/domain-types/time-sale';

export function cssLength(value: string | number | undefined) {
  const match = String(value ?? '')
    .trim()
    .match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(px|pt|%|em|rem|vw|vh)?$/);

  return match ? { amount: Number(match[1]), unit: match[2] ?? 'px' } : null;
}

export function convertCssUnit(amount: number, from: string, to: string) {
  const converted =
    from === 'px' && to === 'pt'
      ? amount * 0.75
      : from === 'pt' && to === 'px'
        ? amount / 0.75
        : amount;

  return Math.round(converted * 100) / 100;
}

export const cssSides = ['Top', 'Right', 'Bottom', 'Left'] as const;

export function changeCssBorder(
  value: SaleCss,
  selected: boolean[],
  width: string,
  color: string
) {
  const result = { ...value };
  const style =
    value.borderStyle === 'none' ? 'solid' : (value.borderStyle ?? 'solid');
  delete result.border;
  delete result.borderWidth;
  delete result.borderColor;
  delete result.borderStyle;

  cssSides.forEach((side, index) => {
    result[`border${side}`] = selected[index]
      ? `${width} ${style} ${color}`
      : 'none';
  });

  return result;
}

export function cssRadiusAxes(value: string | number | undefined) {
  const text = String(value ?? '0');
  let depth = 0;
  let separator = -1;

  for (let index = 0; index < text.length; index++) {
    if (text[index] === '(') depth++;
    if (text[index] === ')') depth--;
    if (text[index] === '/' && depth === 0) separator = index;
  }

  const horizontal = cssBoxSides(
    separator < 0 ? text : text.slice(0, separator)
  );
  const vertical =
    separator < 0 ? [...horizontal] : cssBoxSides(text.slice(separator + 1));

  return [horizontal, vertical];
}

export function changeCssRadius(
  value: SaleCss,
  selected: boolean[],
  axis: number,
  next: string
) {
  const axes = cssRadiusAxes(value.borderRadius);
  axes[axis] = axes[axis].map((current, index) =>
    selected[index] ? next : current
  );

  return {
    ...value,
    borderRadius: `${axes[0].join(' ')} / ${axes[1].join(' ')}`,
  };
}

export function cssBoxSides(value: string | number | undefined): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let token = '';

  for (const character of String(value ?? '0')) {
    if (character === '(') depth++;
    if (character === ')') depth--;

    if (/\s/.test(character) && depth === 0) {
      if (token) tokens.push(token);
      token = '';
    } else token += character;
  }

  if (token) tokens.push(token);
  const [top = '0', right = top, bottom = top, left = right] = tokens;

  return [top, right, bottom, left];
}

export function changeCssSide(
  value: SaleCss,
  kind: 'padding' | 'margin',
  side: (typeof cssSides)[number],
  next: string
) {
  const result = { ...value };
  const sides = cssBoxSides(value[kind]);
  delete result[kind];

  cssSides.forEach((direction, index) => {
    const key = `${kind}${direction}`;
    result[key] = direction === side ? next : (value[key] ?? sides[index]);
  });

  return result;
}
