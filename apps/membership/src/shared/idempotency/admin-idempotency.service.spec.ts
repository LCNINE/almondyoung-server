import { AdminIdempotencyService } from './admin-idempotency.service';

// begin()의 분기 판정을 검증한다. drizzle 체인은 터미널(returning/limit) 반환값으로 시나리오를 제어.
function makeService(opts: {
  insertReturn?: unknown[]; // insert ... onConflictDoNothing().returning()
  selectReturn?: unknown[]; // select ... limit()
  updateReturn?: unknown[]; // update ... returning() (reclaim)
}) {
  const db = {
    insert: () => ({
      values: () => ({ onConflictDoNothing: () => ({ returning: () => Promise.resolve(opts.insertReturn ?? []) }) }),
    }),
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(opts.selectReturn ?? []) }) }),
    }),
    update: () => ({
      set: () => ({ where: () => ({ returning: () => Promise.resolve(opts.updateReturn ?? []) }) }),
    }),
  };
  return new AdminIdempotencyService({ db } as never);
}

const future = new Date(Date.now() + 60_000);
const past = new Date(Date.now() - 60_000);

describe('AdminIdempotencyService.begin', () => {
  it('proceeds when the key is newly claimed', async () => {
    const svc = makeService({ insertReturn: [{ id: 'x' }] });
    const res = await svc.begin('grant', 'k1', 'h1');
    expect(res.kind).toBe('proceed');
  });

  it('replays the stored response for a COMPLETED key with the same request hash', async () => {
    const svc = makeService({
      insertReturn: [],
      selectReturn: [{ requestHash: 'h1', status: 'COMPLETED', responseJson: { ok: 1 }, lockedUntil: future }],
    });
    expect(await svc.begin('grant', 'k1', 'h1')).toEqual({ kind: 'replay', response: { ok: 1 } });
  });

  it('conflicts when the same key carries a different request hash', async () => {
    const svc = makeService({
      insertReturn: [],
      selectReturn: [{ requestHash: 'OTHER', status: 'COMPLETED', responseJson: {}, lockedUntil: future }],
    });
    const res = await svc.begin('grant', 'k1', 'h1');
    expect(res.kind).toBe('conflict');
  });

  it('conflicts when an identical request is still PROCESSING (lock valid)', async () => {
    const svc = makeService({
      insertReturn: [],
      selectReturn: [{ requestHash: 'h1', status: 'PROCESSING', lockedUntil: future }],
    });
    const res = await svc.begin('grant', 'k1', 'h1');
    expect(res.kind).toBe('conflict');
  });

  it('re-claims (proceed) a FAILED key with the same request hash', async () => {
    const svc = makeService({
      insertReturn: [],
      selectReturn: [{ requestHash: 'h1', status: 'FAILED', lockedUntil: past }],
      updateReturn: [{ id: 'x' }],
    });
    const res = await svc.begin('grant', 'k1', 'h1');
    expect(res.kind).toBe('proceed');
  });

  it('re-claims a stale PROCESSING (lock expired) with the same request hash', async () => {
    const svc = makeService({
      insertReturn: [],
      selectReturn: [{ requestHash: 'h1', status: 'PROCESSING', lockedUntil: past }],
      updateReturn: [{ id: 'x' }],
    });
    const res = await svc.begin('grant', 'k1', 'h1');
    expect(res.kind).toBe('proceed');
  });

  it('hashes semantically identical objects in a stable order', () => {
    const svc = makeService({});
    expect(svc.hashRequest({ body: { b: 2, a: 1 }, params: { id: 'c1' } })).toBe(
      svc.hashRequest({ params: { id: 'c1' }, body: { a: 1, b: 2 } }),
    );
  });

  it('includes request identity such as params in the hash payload', () => {
    const svc = makeService({});
    expect(svc.hashRequest({ body: { reason: 'x' }, params: { id: 'c1' } })).not.toBe(
      svc.hashRequest({ body: { reason: 'x' }, params: { id: 'c2' } }),
    );
  });
});
