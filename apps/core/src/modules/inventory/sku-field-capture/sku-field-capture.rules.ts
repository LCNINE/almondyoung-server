import { authenticatedWarehouseActor, type WarehouseActor } from '../core/services/warehouse-operation-contract';

export { normalizePositionCode } from './position-code';

export const MIN_REFERENCE_PHOTOS = 3;
export const MAX_PACKAGE_MM = 5000;
export const MAX_PACKAGE_G = 100_000;

export const FIELD_CAPTURE_BARCODE_STATUSES = ['scanned', 'no_manufacturer', 'none'] as const;
export type FieldCaptureBarcodeStatus = (typeof FIELD_CAPTURE_BARCODE_STATUSES)[number];

export type FieldCaptureActor = { workerId: string; workerLabel: string };

export function fieldCaptureActorOf(
  user: NonNullable<WarehouseActor> & { email?: string; login_id?: string },
): FieldCaptureActor {
  const workerId = authenticatedWarehouseActor(user);
  return { workerId, workerLabel: user.login_id ?? user.email ?? workerId };
}
