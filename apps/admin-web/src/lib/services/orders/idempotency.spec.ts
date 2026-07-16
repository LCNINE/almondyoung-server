import { createIdempotentCommand, idempotencyHeaders } from './idempotency';

describe('fulfillment idempotency commands', () => {
  it('creates a UUID key for a new logical command', () => {
    const command = createIdempotentCommand({ shipmentId: 'shipment-1' });

    expect(command.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(idempotencyHeaders(command.idempotencyKey)).toEqual({
      'Idempotency-Key': command.idempotencyKey,
    });
  });

  it('retains the exact original key for pending/recovery retry', () => {
    const original = createIdempotentCommand(
      { expectedManifestVersion: 3 },
      '4e8e3b7f-37df-41fb-a084-47915ba7b6cf'
    );
    const retry = createIdempotentCommand(
      original.data,
      original.idempotencyKey
    );

    expect(retry).toEqual(original);
  });
});
