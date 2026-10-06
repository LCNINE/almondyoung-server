/** Medusa 금액은 number / string / BigNumber 로 섞여 온다. 숫자가 아니면 NaN. */
export function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return v.trim() === '' ? NaN : Number(v);
  if (v && typeof v === 'object') {
    const raw = (v as { numeric_?: unknown; value?: unknown }).numeric_ ?? (v as { value?: unknown }).value;
    if (raw !== undefined) return toNumber(raw);
  }
  return NaN;
}
