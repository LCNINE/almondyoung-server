import { describe, it, expect, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { createOperationStore } from './operationStore';
const input = () => ({
  id: crypto.randomUUID(),
  scope: 'actor|server',
  resource: 'box:1',
  method: 'POST',
  path: '/shipments/1/simple-outbound-scans',
  bodyJson: '{"barcode":"A","quantity":1}',
  createdAt: Date.now(),
});
describe('persistent operations', () => {
  it('retries opening the same store after a transient IndexedDB failure', async () => {
    const store = createOperationStore(crypto.randomUUID());
    const open = vi.spyOn(indexedDB, 'open').mockImplementationOnce(() => {
      throw new Error('indexeddb unavailable');
    });

    await expect(store.pending('actor|server')).rejects.toThrow(
      'indexeddb unavailable'
    );
    expect(await store.pending('actor|server')).toEqual([]);

    open.mockRestore();
  });

  it('survives reopening and refuses a different operation on an unresolved resource', async () => {
    const dbName = crypto.randomUUID();
    const op = input();
    await createOperationStore(dbName).begin(op);
    const reopened = createOperationStore(dbName);
    expect((await reopened.pending(op.scope))[0].id).toBe(op.id);
    await expect(
      reopened.begin({ ...op, id: crypto.randomUUID(), bodyJson: '{}' })
    ).rejects.toThrow();
    await reopened.finish(op.id, 'confirmed', { ok: true });
    expect(await reopened.pending(op.scope)).toEqual([]);
    expect((await reopened.begin(op)).result).toEqual({ ok: true });
  });
  it('never reuses a key for a changed payload', async () => {
    const store = createOperationStore(crypto.randomUUID());
    const op = input();
    await store.begin(op);
    await expect(
      store.begin({ ...op, bodyJson: '{"quantity":9}' })
    ).rejects.toThrow();
  });
});
it('allows only one live sender across database connections and permits expired lease recovery', async () => {
  const name = crypto.randomUUID(),
    a = createOperationStore(name),
    b = createOperationStore(name),
    op = input();
  await a.begin(op);
  expect(await a.claim(op.id, op.scope, 'a', 100)).toBe(true);
  expect(await b.claim(op.id, op.scope, 'b', 101)).toBe(false);
  expect(await b.claim(op.id, 'different actor', 'b', 30000)).toBe(false);
  expect(await b.claim(op.id, op.scope, 'b', 30000)).toBe(true);
});
