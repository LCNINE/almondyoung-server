import type { MedusaOrder } from './medusa.client';

type MedusaPaymentStatus = MedusaOrder['payment_status'];

/**
 * Medusa order classification constants, shared by `MedusaClient` (collectable filter) and
 * `MedusaOrderProvider` (creation eligibility / lifecycle detection).
 *
 * These live in their own module on purpose: specs mock `medusa.client` (and provide only a stub
 * `MedusaClient`), so importing these RUNTIME values from `medusa.client` would resolve them to
 * `undefined` under the mock and blow up every provider test at `PAYMENT_ACCEPTED_STATUSES.has(...)`.
 * Keep them here, where nothing is mocked. The `MedusaOrder` reference above is a type-only import,
 * so it is erased at runtime and creates no dependency on (or cycle with) the mocked module.
 */
export const PAYMENT_ACCEPTED_STATUSES = new Set<MedusaPaymentStatus>(['authorized', 'captured']);

export const LIFECYCLE_PAYMENT_STATUSES = new Set<MedusaPaymentStatus>([
  'partially_refunded',
  'refunded',
  'canceled',
]);
