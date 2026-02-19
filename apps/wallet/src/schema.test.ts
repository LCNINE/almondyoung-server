import { walletSchema } from './schema';

export * from './schema';
export { idempotencyKeys } from './domain/idempotency/idempotency.schema';

export const walletTestSchema = walletSchema;

export type WalletTestSchema = typeof walletTestSchema;
