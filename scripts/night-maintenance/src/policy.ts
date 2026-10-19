export interface JobWindow {
  startsAt: string;
  writesStopAt: string;
  endsAt: string;
}

export function jobWindow(date: string, job: string): JobWindow {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Invalid dated run');
  }

  const toUtc = (time: string) => new Date(`${date}T${time}:00+09:00`).toISOString();

  return job === 'reviews'
    ? { startsAt: toUtc('01:00'), writesStopAt: toUtc('01:45'), endsAt: toUtc('01:50') }
    : { startsAt: toUtc('03:00'), writesStopAt: toUtc('05:50'), endsAt: toUtc('06:00') };
}

export interface ReviewTarget {
  id: string;
  productId: string;
  rating: number;
}

export interface ReviewExpected {
  count: number;
  rating2: number;
  rating3: number;
  products: number;
}

export function assertWriteWindow(window: JobWindow, now: Date): void {
  const [start, stop, end] = [window.startsAt, window.writesStopAt, window.endsAt].map(Date.parse);

  if (![start, stop, end, now.getTime()].every(Number.isFinite) || !(start < stop && stop < end)) {
    throw new Error('Invalid dated write window');
  }

  if (now.getTime() < start || now.getTime() >= stop) {
    throw new Error('Outside dated write window');
  }
}

const PRODUCT_FIELDS = new Set([
  'productNumber',
  'weight',
  'dimensions',
  'origin',
  'capacity',
  'expirationDate',
  'manufacturer',
  'material',
  'usage',
]);

export function emptyApprovedFields(
  existing: Record<string, unknown>,
  proposed: Record<string, string>,
): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const [field, value] of Object.entries(proposed)) {
    if (!PRODUCT_FIELDS.has(field)) throw new Error(`Unapproved product field: ${field}`);
    if (typeof value !== 'string' || !value.trim()) throw new Error('Approved value cannot be empty');
    if (!String(existing[field] ?? '').trim()) fields[field] = value;
  }

  return fields;
}

export function validateReviewManifest(rows: ReviewTarget[], expected: ReviewExpected): void {
  const ids = new Set(rows.map((row) => row.id));
  const products = new Set(rows.map((row) => row.productId));
  const rating2 = rows.filter((row) => row.rating === 2).length;
  const rating3 = rows.filter((row) => row.rating === 3).length;

  if (
    ids.size !== rows.length ||
    rows.length !== expected.count ||
    products.size !== expected.products ||
    rating2 !== expected.rating2 ||
    rating3 !== expected.rating3 ||
    rating2 + rating3 !== rows.length
  ) {
    throw new Error('Review manifest differs from approved scope');
  }
}
