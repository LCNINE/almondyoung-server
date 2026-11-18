import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { CoreApiError, httpCoreApi } from './core-api';

interface Seen {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

describe('httpCoreApi', () => {
  let server: http.Server;
  let url = '';
  let seen: Seen[] = [];
  let reply: { status: number; body: string } = { status: 200, body: '{}' };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        seen.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        res.statusCode = reply.status;
        res.setHeader('content-type', 'application/json');
        res.end(reply.body);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
  });
  beforeEach(() => {
    seen = [];
    reply = { status: 200, body: '{}' };
  });

  it('sends bearer and idempotency key', async () => {
    reply = { status: 200, body: JSON.stringify({ succeeded: ['a'], failed: [] }) };
    const api = httpCoreApi(url, async () => 't1');
    const r = await api.plan(['a'], 'emergency:r:plan:a');
    expect(r.succeeded).toEqual(['a']);
    expect(seen[0].method).toBe('POST');
    expect(seen[0].url).toBe('/outbound-preparation/plans');
    expect(seen[0].headers.authorization).toBe('Bearer t1');
    expect(seen[0].headers['idempotency-key']).toBe('emergency:r:plan:a');
    expect(JSON.parse(seen[0].body)).toEqual({ shipmentIds: ['a'] });
  });

  it('asks for a token on every request', async () => {
    const token = jest.fn(async () => 't1');
    const api = httpCoreApi(url, token);
    await api.warehouse('w1');
    await api.warehouse('w1');
    expect(token).toHaveBeenCalledTimes(2);
  });

  it('throws CoreApiError with the core code', async () => {
    reply = {
      status: 409,
      body: JSON.stringify({
        success: false,
        code: 'BATCH_START_BLOCKED',
        errors: [{ shipmentId: 's1', reason: 'STOCK_SHORT' }],
      }),
    };
    const api = httpCoreApi(url, async () => 't1');
    const err = await api.startBatch('b1', 'k').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CoreApiError);
    const e = err as CoreApiError;
    expect(e.status).toBe(409);
    expect(e.code).toBe('BATCH_START_BLOCKED');
    expect((e.body as { errors: { shipmentId: string }[] }).errors[0].shipmentId).toBe('s1');
  });

  it('returns null for no active waybill', async () => {
    reply = { status: 200, body: '' };
    const api = httpCoreApi(url, async () => 't1');
    expect(await api.activeWaybill('s1')).toBeNull();
  });

  it('never puts the token in an error message', async () => {
    reply = { status: 500, body: JSON.stringify({ success: false, message: 'boom' }) };
    const api = httpCoreApi(url, async () => 't1');
    const e = (await api.warehouse('w1').catch((x: unknown) => x)) as CoreApiError;
    expect(e).toBeInstanceOf(CoreApiError);
    expect(e.message).not.toContain('t1');
    expect(JSON.stringify(e.body)).not.toContain('Bearer');
  });

  it('builds routes and bodies', async () => {
    reply = { status: 200, body: JSON.stringify({ batchId: 'b1', operationId: 'o' }) };
    const api = httpCoreApi(url, async () => 't1');
    await api.createBatch('w1', 'N', 'k1');
    expect(seen[0].url).toBe('/outbound-batches/v2');
    expect(JSON.parse(seen[0].body)).toEqual({
      warehouseId: 'w1',
      pickingMethod: 'individual',
      name: 'N',
    });
    await api.excludeFromBatch('b1', 's1', 'why', 'k2');
    expect(seen[1].method).toBe('DELETE');
    expect(seen[1].url).toBe('/outbound-batches/b1/shipments/s1');
    expect(JSON.parse(seen[1].body)).toEqual({ reason: 'why' });
    await api.preparation('w1', 'ready', 200);
    expect(seen[2].url).toBe('/outbound-preparation?warehouseId=w1&bucket=ready&offset=200');
  });
});
