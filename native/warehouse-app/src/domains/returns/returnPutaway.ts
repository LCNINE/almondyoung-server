import type { ReturnBinContents, ReturnBinItem } from './returnBinApi';

export interface ReturnLocation {
  locationCode: string;
  qty: number;
}

export type PutawayStep =
  | { kind: 'loading' }
  | { kind: 'product'; bin: ReturnBinContents }
  | { kind: 'location'; bin: ReturnBinContents; productBarcode: string; locations: ReturnLocation[] };

export function returnLocations(errors: unknown): ReturnLocation[] {
  if (!Array.isArray(errors)) return [];

  return errors.filter(
    (entry: unknown): entry is ReturnLocation =>
      typeof entry === 'object' &&
      entry !== null &&
      'locationCode' in entry &&
      typeof entry.locationCode === 'string' &&
      'qty' in entry &&
      typeof entry.qty === 'number' &&
      Number.isSafeInteger(entry.qty) &&
      entry.qty > 0,
  );
}

export function afterPutaway(bin: ReturnBinContents, items: ReturnBinItem[]): PutawayStep {
  return { kind: 'product', bin: { ...bin, items } };
}
