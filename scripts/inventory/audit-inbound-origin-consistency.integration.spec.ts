import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import postgres = require('postgres');
import { auditInboundOrigins } from './audit-inbound-origin-consistency';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;
const run = promisify(execFile);
const start = '2026-01-01T00:00:00.000Z';
const middle = '2026-01-02T00:00:00.000Z';
const end = '2026-01-03T00:00:00.000Z';

describeIfDb('inbound origin audit (migrated PostgreSQL)', () => {
  jest.setTimeout(120_000);
  let db: postgres.Sql;
  let warehouseId: string;
  let otherWarehouseId: string;
  let skuId: string;
  let holderId: string;
  let originId: string;
  let shelfId: string;
  let foreignId: string;
  let directory: string;

  beforeAll(() => {
    // Never accidentally prepare historical corruption in a shared database.
    if (new URL(databaseUrl!).pathname !== '/inbound_workflow_consistency_test') {
      throw new Error('Use the dedicated inbound_workflow_consistency_test database.');
    }
    db = postgres(databaseUrl!, { max: 1 });
  });
  afterAll(async () => db?.end());
  beforeEach(async () => {
    warehouseId = randomUUID();
    otherWarehouseId = randomUUID();
    skuId = randomUUID();
    holderId = randomUUID();
    originId = randomUUID();
    shelfId = randomUUID();
    foreignId = randomUUID();
    directory = await mkdtemp(join(tmpdir(), 'inbound-origin-audit-'));
    await db`INSERT INTO warehouses (id, name) VALUES (${warehouseId}, 'audit fixture'), (${otherWarehouseId}, 'audit other')`;
    await db`INSERT INTO holders (id, name) VALUES (${holderId}, 'audit holder')`;
    await db`INSERT INTO skus (id, code, name, holder_id) VALUES (${skuId}, ${randomUUID()}, 'audit sku', ${holderId})`;
    await db`INSERT INTO locations (id, warehouse_id, code, location_type, is_system, system_role)
      VALUES (${originId}, ${warehouseId}, 'AUDIT-ORIGIN', 'zone', true, 'inbound_default'),
      (${shelfId}, ${warehouseId}, 'AUDIT-SHELF', 'zone', false, null),
      (${foreignId}, ${otherWarehouseId}, 'AUDIT-FOREIGN', 'zone', true, 'inbound_default')`;
  });
  afterEach(async () => {
    if (!db || !skuId) return;
    await db`DELETE FROM inbound_work_logs WHERE sku_id = ${skuId}`;
    await db`DELETE FROM inbound_receipts WHERE warehouse_id IN (${warehouseId}, ${otherWarehouseId})`;
    await db`DELETE FROM batch_inventory_session_balances WHERE sku_id = ${skuId}`;
    await db`DELETE FROM batch_inventory_sessions WHERE batch_id IN
      (SELECT id FROM outbound_batches WHERE warehouse_id = ${warehouseId})`;
    await db`DELETE FROM outbound_batches WHERE warehouse_id = ${warehouseId}`;
    await db`DELETE FROM stock_events WHERE sku_id = ${skuId}`;
    await db`DELETE FROM stock_ledgers WHERE sku_id = ${skuId}`;
    await db`DELETE FROM locations WHERE warehouse_id IN (${warehouseId}, ${otherWarehouseId})`;
    await db`DELETE FROM skus WHERE id = ${skuId}`;
    await db`DELETE FROM holders WHERE id = ${holderId}`;
    await db`DELETE FROM warehouses WHERE id IN (${warehouseId}, ${otherWarehouseId})`;
    await rm(directory, { recursive: true, force: true });
  });

  async function receipt(
    quantity = 10,
    options: {
      origin?: string | null;
      warehouse?: string;
      putaway?: number;
      returned?: number;
      canceled?: number;
      occurredAt?: string;
      status?: string;
      source?: string;
    } = {},
  ) {
    const receiptId = randomUUID();
    const lineId = randomUUID();
    await db`INSERT INTO inbound_receipts
      (id, method, warehouse_id, occurred_at, total_quantity, status)
      VALUES (${receiptId}, 'simple', ${options.warehouse ?? warehouseId}, ${options.occurredAt ?? start},
        ${quantity}, ${options.status ?? 'posted'})`;
    await db`INSERT INTO inbound_receipt_lines
      (id, receipt_id, sku_id, quantity, origin_location_id, putaway_from_origin_qty, returned_qty,
       canceled_qty, source, created_at, updated_at)
      VALUES (${lineId}, ${receiptId}, ${skuId}, ${quantity}, ${options.origin === undefined ? originId : options.origin},
      ${options.putaway ?? 0}, ${options.returned ?? 0}, ${options.canceled ?? 0},
      ${options.source ?? 'direct'}, ${start}, ${end})`;
    return { receiptId, lineId };
  }
  async function ledger(qty: number, location = originId, warehouse = warehouseId) {
    await db`INSERT INTO stock_ledgers (sku_id, warehouse_id, location_id, stock_state, qty)
      VALUES (${skuId}, ${warehouse}, ${location}, 'ON_HAND', ${qty})
      ON CONFLICT (sku_id, warehouse_id, location_id, stock_state) DO UPDATE SET qty = EXCLUDED.qty`;
  }
  async function outbound(transition = 'MOVE', occurredAt = middle, location = originId, warehouse = warehouseId) {
    const id = randomUUID();
    await db`INSERT INTO stock_events
      (id, sku_id, from_warehouse_id, from_location_id, from_state, to_warehouse_id, to_location_id,
       to_state, transition_type, quantity, occurred_at)
      VALUES (${id}, ${skuId}, ${warehouse}, ${location}, 'ON_HAND',
        ${transition === 'MOVE' ? warehouse : null}, ${transition === 'MOVE' ? shelfId : null},
        ${transition === 'MOVE' ? 'ON_HAND' : null}, ${transition}, 10, ${occurredAt})`;
    return id;
  }
  async function snapshot() {
    const tables = [
      'warehouses',
      'locations',
      'skus',
      'stock_ledgers',
      'stock_events',
      'inbound_receipts',
      'inbound_receipt_lines',
      'inbound_work_logs',
      'outbound_batches',
      'batch_inventory_sessions',
      'batch_inventory_session_balances',
    ];
    const result: Record<string, unknown> = {};
    for (const table of tables) {
      result[table] = await db.unsafe(`SELECT row_to_json(t) AS row FROM ${table} t ORDER BY row_to_json(t)::text`);
    }
    return JSON.stringify(result);
  }
  async function auditUnchanged() {
    const before = await snapshot();
    const report = await auditInboundOrigins(db, warehouseId);
    expect(await snapshot()).toBe(before);
    expect(report).toMatchObject({ version: 1, warehouseId });
    expect(Number.isNaN(Date.parse(report.checkedAt))).toBe(false);
    return report;
  }
  async function cli(
    args = ['--warehouse-id', warehouseId, '--output', join(directory, 'report.json')],
    url: string | null = databaseUrl!,
  ) {
    const env = { ...process.env };
    if (url === null) delete env.DATABASE_URL;
    else env.DATABASE_URL = url;
    try {
      const result = await run(
        process.execPath,
        [
          resolve('node_modules/tsx/dist/cli.mjs'),
          resolve('scripts/inventory/audit-inbound-origin-consistency.ts'),
          ...args,
        ],
        { env },
      );
      return { ...result, code: 0 };
    } catch (error: any) {
      return { code: error.code, stdout: error.stdout, stderr: error.stderr };
    }
  }

  it('reports historical receive 10 / general move 10 / receive 1 without changing any rows', async () => {
    const first = await receipt();
    const move = await outbound();
    const second = await receipt(1, { occurredAt: end, source: 'purchase_order' });
    await ledger(1);
    const { candidates } = await auditUnchanged();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      skuId,
      originLocationId: originId,
      onHandQty: 1,
      pendingQty: 11,
      batchControlledQty: 0,
      generallyAvailableQty: 0,
      reasons: ['INSUFFICIENT_ORIGIN', 'POSSIBLE_BYPASS'],
      eventIds: [move],
    });
    expect(candidates[0].lineIds.sort()).toEqual([first.lineId, second.lineId].sort());
    expect(candidates[0].lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lineId: first.lineId,
          receiptId: first.receiptId,
          quantity: 10,
          putawayFromOriginQty: 0,
          returnedQty: 0,
          canceledQty: 0,
          pendingQty: 10,
          occurredAt: start,
          createdAt: start,
          updatedAt: end,
        }),
      ]),
    );
  });
  it('returns no candidates for healthy pending and ordinary shelf direct receipts', async () => {
    await receipt();
    await ledger(12);
    await receipt(20, { origin: shelfId });
    await outbound('ADJUST_DOWN', middle, shelfId);
    await ledger(10, shelfId);
    expect((await auditUnchanged()).candidates).toEqual([]);
    expect((await cli()).code).toBe(0);
  });
  it.each([0, null])('reports zero/missing ledger (%s)', async (qty) => {
    await receipt();
    if (qty !== null) await ledger(qty);
    expect((await auditUnchanged()).candidates[0]).toMatchObject({
      onHandQty: 0,
      pendingQty: 10,
      reasons: ['INSUFFICIENT_ORIGIN'],
    });
  });
  it.each(['MOVE', 'ADJUST_DOWN', 'SHIP'])(
    'retains %s bypass evidence after replenishment matches pending',
    async (type) => {
      await receipt();
      const event = await outbound(type);
      await ledger(10);
      expect((await auditUnchanged()).candidates[0]).toMatchObject({
        pendingQty: 10,
        onHandQty: 10,
        reasons: ['POSSIBLE_BYPASS'],
        eventIds: [event],
      });
    },
  );
  it('includes fully consumed legacy lines in their possible pending interval', async () => {
    await receipt(10, { putaway: 10 });
    const event = await outbound();
    await ledger(10);
    expect((await auditUnchanged()).candidates[0]).toMatchObject({
      pendingQty: 0,
      generallyAvailableQty: 10,
      reasons: ['POSSIBLE_BYPASS'],
      eventIds: [event],
    });
  });
  it('excludes pre-receipt, post-completion, other warehouse, and voided receipt evidence', async () => {
    await receipt(10, { putaway: 10 });
    await outbound('ADJUST_DOWN', '2025-12-31T00:00:00Z');
    await outbound('ADJUST_DOWN', '2026-01-04T00:00:00Z');
    await receipt(50, { warehouse: otherWarehouseId, origin: foreignId });
    await outbound('ADJUST_DOWN', middle, foreignId, otherWarehouseId);
    await receipt(30, { status: 'voided' });
    expect((await auditUnchanged()).candidates).toEqual([]);
  });
  it.each([{ putaway: 11 }, { returned: -1 }, { canceled: -1 }, { putaway: -1 }, { origin: null }])(
    'reports invalid receipt facts without hiding the row: %j',
    async (options) => {
      const { lineId } = await receipt(10, options);
      await ledger(100);
      expect((await auditUnchanged()).candidates[0]).toMatchObject({
        lineIds: [lineId],
        originLocationId: options.origin === null ? null : originId,
        reasons: ['INVALID_RECEIPT'],
      });
    },
  );
  it('reports nonpositive receipts and foreign origins without inventing origin or pending', async () => {
    const zero = await receipt(0);
    const foreign = await receipt(5, { origin: foreignId });
    const candidates = (await auditUnchanged()).candidates;
    expect(candidates).toHaveLength(2);
    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ lineIds: [zero.lineId], reasons: ['INVALID_RECEIPT'] }),
        expect.objectContaining({
          originLocationId: foreignId,
          lineIds: [foreign.lineId],
          pendingQty: 0,
          reasons: ['INVALID_RECEIPT'],
        }),
      ]),
    );
  });
  it.each(['PUTAWAY', 'RETURN', 'CANCEL'])('valid %s work events are not general bypass evidence', async (type) => {
    const { receiptId, lineId } = await receipt(20, {
      putaway: type === 'PUTAWAY' ? 10 : 0,
      returned: type === 'RETURN' ? 10 : 0,
      canceled: type === 'CANCEL' ? 10 : 0,
    });
    const eventId = await outbound(type === 'PUTAWAY' ? 'MOVE' : 'ADJUST_DOWN');
    if (type === 'CANCEL') {
      const original = randomUUID();
      await db`INSERT INTO stock_events (id, sku_id, to_warehouse_id, to_location_id, to_state,
        transition_type, quantity, occurred_at, event_status) VALUES (${original}, ${skuId}, ${warehouseId},
        ${originId}, 'ON_HAND', 'RECEIVE', 10, ${start}, 'VOIDED')`;
      await db`UPDATE inbound_receipt_lines SET event_id = ${original} WHERE id = ${lineId}`;
      await db`UPDATE stock_events SET reversal_of_event_id = ${original} WHERE id = ${eventId}`;
    }
    await db`INSERT INTO inbound_work_logs (type, receipt_id, line_id, sku_id, warehouse_id,
      from_location_id, to_location_id, quantity, event_id, timestamp)
      VALUES (${type}, ${receiptId}, ${lineId}, ${skuId}, ${warehouseId}, ${originId},
        ${type === 'PUTAWAY' ? shelfId : null}, 10, ${eventId}, ${middle})`;
    await ledger(10);
    expect((await auditUnchanged()).candidates).toEqual([]);
  });
  it('does not relabel a voided kernel event as a general bypass', async () => {
    const { receiptId, lineId } = await receipt(20, { putaway: 10 });
    const eventId = await outbound();
    await db`UPDATE stock_events SET event_status = 'VOIDED' WHERE id = ${eventId}`;
    await db`INSERT INTO inbound_work_logs (type, receipt_id, line_id, sku_id, warehouse_id,
      from_location_id, to_location_id, quantity, event_id, timestamp)
      VALUES ('PUTAWAY', ${receiptId}, ${lineId}, ${skuId}, ${warehouseId}, ${originId}, ${shelfId}, 10, ${eventId}, ${middle})`;
    await ledger(10);
    expect((await auditUnchanged()).candidates).toEqual([]);
  });
  it('does not hide general events when a mismatched work log mentions their ID', async () => {
    const { receiptId, lineId } = await receipt();
    const eventId = await outbound();
    await db`INSERT INTO inbound_work_logs (type, receipt_id, line_id, sku_id, warehouse_id,
      from_location_id, to_location_id, quantity, event_id, timestamp)
      VALUES ('PUTAWAY', ${receiptId}, ${lineId}, ${skuId}, ${warehouseId}, ${originId}, ${shelfId}, 1, ${eventId}, ${middle})`;
    await ledger(10);
    expect((await auditUnchanged()).candidates[0]).toMatchObject({ eventIds: [eventId], reasons: ['POSSIBLE_BYPASS'] });
  });
  it('uses proven work completion instead of a later updated timestamp', async () => {
    const { receiptId, lineId } = await receipt(10, { putaway: 10 });
    const eventId = await outbound('MOVE', middle);
    await db`INSERT INTO inbound_work_logs (type, receipt_id, line_id, sku_id, warehouse_id,
      from_location_id, to_location_id, quantity, event_id, timestamp)
      VALUES ('PUTAWAY', ${receiptId}, ${lineId}, ${skuId}, ${warehouseId}, ${originId}, ${shelfId}, 10, ${eventId}, ${middle})`;
    await outbound('ADJUST_DOWN', '2026-01-02T12:00:00Z');
    expect((await auditUnchanged()).candidates).toEqual([]);
  });
  it('subtracts active/recovery batch custody once without multiplying by receipt count', async () => {
    await receipt(4);
    await receipt(6);
    await ledger(12);
    const batchId = randomUUID();
    const sessionId = randomUUID();
    await db`INSERT INTO outbound_batches (id, batch_number, warehouse_id, picking_method)
      VALUES (${batchId}, ${randomUUID()}, ${warehouseId}, 'total_picking')`;
    await db`INSERT INTO batch_inventory_sessions (id, batch_id, status, recovery_reason)
      VALUES (${sessionId}, ${batchId}, 'recovery_required', 'fixture')`;
    await db`INSERT INTO batch_inventory_session_balances (session_id, sku_id, source_location_id, custody_type, qty)
      VALUES (${sessionId}, ${skuId}, ${originId}, 'AT_SOURCE', 3)`;
    expect((await auditUnchanged()).candidates[0]).toMatchObject({
      onHandQty: 12,
      pendingQty: 10,
      batchControlledQty: 3,
      generallyAvailableQty: 0,
      reasons: ['INSUFFICIENT_ORIGIN'],
    });
  });
  it.each([
    'UPDATE stock_ledgers SET qty = qty WHERE false',
    'DELETE FROM stock_ledgers WHERE false',
    'INSERT INTO stock_ledgers SELECT * FROM stock_ledgers WHERE false',
  ])('enforces repeatable-read and rejects writes: %s', async (write) => {
    const begin = db.begin.bind(db);
    const spy = jest.spyOn(db, 'begin').mockImplementation(((options: string, callback: any) =>
      begin(options, async (tx) => {
        const [settings] = await tx`SELECT current_setting('transaction_isolation') AS isolation,
          current_setting('transaction_read_only') AS readonly`;
        expect(settings).toEqual({ isolation: 'repeatable read', readonly: 'on' });
        await tx.unsafe(write);
        return callback(tx);
      })) as any);
    try {
      await expect(auditInboundOrigins(db, warehouseId)).rejects.toMatchObject({ code: '25006' });
    } finally {
      spy.mockRestore();
    }
  });
  it('writes candidates with exit 2, private permissions, no overwrite including symlinks', async () => {
    await receipt();
    const before = await snapshot();
    expect((await cli()).code).toBe(2);
    const output = join(directory, 'report.json');
    const first = await readFile(output, 'utf8');
    expect((await stat(output)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(first).candidates).toHaveLength(1);
    expect((await cli()).code).toBe(1);
    expect(await readFile(output, 'utf8')).toBe(first);
    const link = join(directory, 'link.json');
    await symlink(output, link);
    expect((await cli(['--warehouse-id', warehouseId, '--output', link])).code).toBe(1);
    expect(await readFile(output, 'utf8')).toBe(first);
    expect(await snapshot()).toBe(before);
  });
  it.each(
    [
      [],
      ['--warehouse-id', 'bad', '--output', '/tmp/audit.json'],
      ['--warehouse-id', '00000000-0000-0000-0000-000000000000', '--output', 'relative.json'],
      ['--warehouse-id'],
      ['--unknown', 'value'],
    ].map((args) => [args]),
  )('rejects malformed CLI arguments: %j', async (args) => expect((await cli(args)).code).toBe(1));
  it('rejects duplicate flags, missing DATABASE_URL, unknown warehouse and output failure', async () => {
    const args = ['--warehouse-id', warehouseId, '--output', join(directory, 'report.json')];
    expect((await cli([...args, '--warehouse-id', warehouseId])).code).toBe(1);
    // An empty explicit value must not be replaced from any .env file.
    expect((await cli(args, '')).code).toBe(1);
    expect((await cli(args, null)).code).toBe(1);
    expect((await cli(['--warehouse-id', randomUUID(), '--output', join(directory, 'missing.json')])).code).toBe(1);
    expect(
      (await cli(['--warehouse-id', warehouseId, '--output', join(directory, 'absent', 'report.json')])).code,
    ).toBe(1);
  });
  it('redacts connection credentials and raw errors on failure', async () => {
    const secretUrl = 'postgresql://audit-secret-user:audit-secret-password@127.0.0.1:1/no-db?connect_timeout=1';
    const result = await cli(undefined, secretUrl);
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).not.toMatch(/audit-secret|postgresql:\/\//);
  });
});
