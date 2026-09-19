export const BRUSH_HEIGHT = 28;
export const X_AXIS_HEIGHT = 63;
export const CHART_MARGIN = { top: 3, right: 8, bottom: 0, left: 0 };
export const CHART_HEIGHT = 3 + 279 + X_AXIS_HEIGHT + BRUSH_HEIGHT;
export const CHART_BLOCK_HEIGHT = CHART_HEIGHT + 39;
export const LEGEND_CLASS = 'mt-[19px] flex h-5 items-center justify-center gap-4 text-sm text-[#2B2B2B]';

const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

export function yDomainMax(dataMax: number) {
  if (!(dataMax > 0)) return 4;
  const raw = (dataMax * 1.1) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = (NICE_STEPS.find((candidate) => candidate * magnitude >= raw) ?? 10) * magnitude;
  return Math.max(1, step) * 4;
}

export const TOOLTIP_STYLE = {
  borderRadius: 8,
  border: 'none',
  boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
  fontSize: 14,
  color: '#2B2B2B',
};
