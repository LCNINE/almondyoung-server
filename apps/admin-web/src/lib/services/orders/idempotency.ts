export interface IdempotentCommand<T> {
  data: T;
  idempotencyKey: string;
}

/**
 * A retryable command is created once and retained by the caller while its
 * durable operation is pending/recovery_required. Reusing this object reuses
 * the exact original key; creating a new command creates a new logical action.
 */
export function createIdempotentCommand<T>(
  data: T,
  originalIdempotencyKey?: string
): IdempotentCommand<T> {
  return {
    data,
    idempotencyKey: originalIdempotencyKey ?? crypto.randomUUID(),
  };
}

export function idempotencyHeaders(idempotencyKey: string): {
  'Idempotency-Key': string;
} {
  if (!idempotencyKey.trim()) {
    throw new Error('Idempotency-Key must not be empty');
  }
  return { 'Idempotency-Key': idempotencyKey };
}
