/** Database rows use Date; idempotency JSONB replay preserves ISO strings. */
export type ReplayableDates<T> = { [K in keyof T]: T[K] extends Date ? Date | string : T[K] };

export function storedDateToIso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}
