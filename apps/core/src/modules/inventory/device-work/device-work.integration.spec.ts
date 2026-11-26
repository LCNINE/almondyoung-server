import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, inArray } from 'drizzle-orm';
import { wmsSchema, wmsTables } from '../schema/inventory.schema';
import { makeDbService } from '../../fulfillment/services/__support__/logistics-wiring';
import { InventoryIdempotencyService } from '../core/services/inventory-idempotency.service';
import { OperationAbandonedError } from '../core/services/operation-key-guard';
import { FulfillmentCommandService } from '../../fulfillment/services/fulfillment-command.service';
import { DeviceWorkManager, DeviceWorkVerdictChangedError } from './device-work.manager';
import { DeviceWorkReader } from './device-work.reader';
import type { ReportedOperationDto, ReportUnresolvedOperationsDto } from './dto/device-work.dto';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('기기 확인할 일 — 보고·판정·버림 잠금', () => {
  jest.setTimeout(60_000);
  const sql = postgres(DATABASE_URL as string, { max: 6 });
  const db = drizzle(sql, { schema: wmsSchema });
  const dbService = makeDbService(db);
  const manager = new DeviceWorkManager(dbService);
  const reader = new DeviceWorkReader(dbService);
  const idempotency = new InventoryIdempotencyService(dbService);
  const commands = new FulfillmentCommandService(dbService);
  const keys: string[] = [];

  afterAll(async () => {
    if (keys.length) {
      await db
        .delete(wmsTables.deviceUnresolvedOperations)
        .where(inArray(wmsTables.deviceUnresolvedOperations.operationKey, keys));
      await db
        .delete(wmsTables.abandonedOperationKeys)
        .where(inArray(wmsTables.abandonedOperationKeys.operationKey, keys));
      await db
        .delete(wmsTables.inventoryIdempotencyRequests)
        .where(inArray(wmsTables.inventoryIdempotencyRequests.key, keys));
      await db
        .delete(wmsTables.fulfillmentCommandRequests)
        .where(inArray(wmsTables.fulfillmentCommandRequests.idempotencyKey, keys));
    }
    await sql.end({ timeout: 5 });
  });

  const newKey = () => {
    const key = randomUUID();
    keys.push(key);
    return key;
  };
  const reported = (operationKey: string, over: Partial<ReportedOperationDto> = {}): ReportedOperationDto => ({
    operationKey,
    method: 'POST',
    path: '/inbound/simple',
    workName: '입고',
    summary: '데모 상품 11 ×3',
    status: 'uncertain',
    attempts: 4,
    recordedAt: new Date().toISOString(),
    ...over,
  });
  let seq = 1;
  const report = (operations: ReportedOperationDto[], over: Partial<ReportUnresolvedOperationsDto> = {}) => ({
    reportSeq: seq++,
    deviceKind: 'station' as const,
    workerName: '김현장',
    operations,
    ...over,
  });
  const row = async (key: string) =>
    (
      await db
        .select()
        .from(wmsTables.deviceUnresolvedOperations)
        .where(eq(wmsTables.deviceUnresolvedOperations.operationKey, key))
    )[0];
  const verdictOf = async (key: string) => (await reader.listOpen()).find((r) => r.operationKey === key)?.verdict;

  /** 기기가 보낸 입고 — 서버 멱등 기록이 남는다 */
  const applyInventory = (key: string) =>
    idempotency.withIdempotency('inbound.simple.v2', key, { key }, async () => ({ receiptId: key }));
  const applyCommand = (key: string) =>
    commands.execute(
      { commandType: 'shipment.simple_outbound.scan', idempotencyKey: key, canonicalRequest: { key } },
      async () => ({ response: { ok: true }, resourceType: 'shipment', resourceId: randomUUID() }),
    );

  it('보고는 덮어쓰고, 목록에서 빠진 것은 기기가 정리한 것으로 닫고, 다시 올라오면 연다', async () => {
    const device = randomUUID();
    const [a, b] = [newKey(), newKey()];
    await manager.report('worker-1', device, report([reported(a), reported(b)]));
    await manager.report('worker-1', device, report([reported(a, { attempts: 7 })]));
    expect(await row(a)).toMatchObject({ attempts: 7, resolvedAt: null, workerName: '김현장', deviceKind: 'station' });
    expect(await row(b)).toMatchObject({ resolution: 'device', resolvedBy: 'worker-1' });
    // 같은 보고를 한 번 더 받아도 결과가 같다
    await manager.report('worker-1', device, report([reported(a, { attempts: 7 })]));
    expect(await row(b)).toMatchObject({ resolution: 'device' });
    await manager.report('worker-1', device, report([reported(a), reported(b)]));
    expect(await row(b)).toMatchObject({ resolution: null, resolvedAt: null });
  });

  it('늦게 도착한 옛 보고는 기기가 그 뒤에 정리한 것을 다시 열지 않는다', async () => {
    const device = randomUUID();
    const [a, fresh] = [newKey(), newKey()];
    await manager.report('worker-1', device, report([reported(a)]));
    // 기기가 보낸 순서는 older → newer 인데 서버에 닿은 순서는 newer → older
    const older = report([reported(a), reported(fresh)]);
    const newer = report([]);
    await manager.report('worker-1', device, newer);
    await expect(manager.report('worker-1', device, older)).resolves.toEqual({ decided: [] });
    expect(await row(a)).toMatchObject({ resolution: 'device' });
    expect(await row(fresh)).toBeUndefined();
  });

  it('다른 작업자·다른 기기의 보고는 남의 기록을 닫거나 덮지 않는다', async () => {
    const device = randomUUID();
    const a = newKey();
    await manager.report('worker-1', device, report([reported(a)]));
    await manager.report('worker-2', device, report([]));
    await manager.report('worker-2', randomUUID(), report([reported(a, { summary: '가짜' })]));
    expect(await row(a)).toMatchObject({ resolvedAt: null, actorId: 'worker-1', summary: '데모 상품 11 ×3' });
  });

  it('요청 키 기록으로 판정하고, 결과가 정해진 키를 기기에 돌려준다', async () => {
    const device = randomUUID();
    const [applied, command, missing, old] = [newKey(), newKey(), newKey(), newKey()];
    await applyInventory(applied);
    await applyCommand(command);
    const { decided } = await manager.report(
      'worker-1',
      device,
      report([
        reported(applied),
        reported(command, { path: '/shipments/s/simple-outbound-scans', workName: '출고' }),
        reported(missing),
        reported(old, { recordedAt: new Date(Date.now() - 30 * 86_400_000).toISOString() }),
      ]),
    );
    expect(decided.sort()).toEqual([applied, command].sort());
    expect(await verdictOf(applied)).toBe('applied');
    expect(await verdictOf(command)).toBe('applied');
    expect(await verdictOf(missing)).toBe('not_applied');
    expect(await verdictOf(old)).toBe('expired');
  });

  it('출고 명령이 끝났어도 아무것도 반영하지 않은 응답이면 «반영되지 않고 닫힘»이다', async () => {
    const [blocked, forceClosed] = [newKey(), newKey()];
    for (const [key, response] of [
      [blocked, { outcome: 'preparation_blocked', code: 'SIMPLE_OUTBOUND_PLAN_INVALIDATED' }],
      [forceClosed, { outcome: 'rejected', code: 'LOCATION_OUTBOUND_FORCE_NOT_APPLIED' }],
    ] as const)
      await commands.execute(
        { commandType: 'shipment.location_outbound.force', idempotencyKey: key, canonicalRequest: { key } },
        async () => ({ response, resourceType: 'shipment', resourceId: randomUUID() }),
      );
    const { decided } = await manager.report(
      'worker-1',
      randomUUID(),
      report([reported(blocked, { workName: '출고' }), reported(forceClosed, { workName: '출고' })]),
    );
    expect(decided.sort()).toEqual([blocked, forceClosed].sort());
    expect(await verdictOf(blocked)).toBe('rejected');
    expect(await verdictOf(forceClosed)).toBe('rejected');
    await expect(manager.resolve('m', blocked, 'abandon')).rejects.toBeInstanceOf(DeviceWorkVerdictChangedError);
  });

  it('반영 안 된 작업을 버리면 그 키로 오는 입고·출고는 반영되지 않는다', async () => {
    const device = randomUUID();
    const [inbound, outbound] = [newKey(), newKey()];
    await manager.report('worker-1', device, report([reported(inbound), reported(outbound)]));
    await manager.resolve('manager-1', inbound, 'abandon');
    await manager.resolve('manager-1', outbound, 'abandon');
    await expect(applyInventory(inbound)).rejects.toBeInstanceOf(OperationAbandonedError);
    await expect(applyCommand(outbound)).rejects.toBeInstanceOf(OperationAbandonedError);
    const left = await db
      .select()
      .from(wmsTables.inventoryIdempotencyRequests)
      .where(eq(wmsTables.inventoryIdempotencyRequests.key, inbound));
    expect(left).toEqual([]);
    expect(await row(inbound)).toMatchObject({ resolution: 'abandoned', resolvedBy: 'manager-1' });
    // 기기가 다시 올리면 «버림»으로 정해진 키라 다시 확인하게 한다
    const { decided } = await manager.report('worker-1', device, report([reported(inbound)]));
    expect(decided).toEqual([inbound]);
    expect(await row(inbound)).toMatchObject({ resolution: 'abandoned' });
  });

  it('같은 정리를 다시 보내면 그대로 돌려주고, 판정과 다른 정리는 거절한다', async () => {
    const device = randomUUID();
    const [missing, applied] = [newKey(), newKey()];
    await applyInventory(applied);
    await manager.report('worker-1', device, report([reported(missing), reported(applied)]));
    await expect(manager.resolve('m', applied, 'abandon')).rejects.toBeInstanceOf(DeviceWorkVerdictChangedError);
    await expect(manager.resolve('m', missing, 'dismiss')).rejects.toBeInstanceOf(DeviceWorkVerdictChangedError);
    await manager.resolve('m', missing, 'abandon');
    await expect(manager.resolve('m', missing, 'abandon')).resolves.toEqual({
      operationKey: missing,
      resolution: 'abandoned',
    });
    await expect(manager.resolve('m', missing, 'dismiss')).rejects.toBeInstanceOf(DeviceWorkVerdictChangedError);
    await expect(manager.resolve('m', applied, 'dismiss')).resolves.toEqual({
      operationKey: applied,
      resolution: 'dismissed',
    });
    expect((await reader.listOpen()).map((r) => r.operationKey)).not.toEqual(expect.arrayContaining([missing]));
  });

  it('판정할 수 없게 된 작업은 목록에서 빼며 그 키도 잠근다', async () => {
    const old = newKey();
    await manager.report(
      'worker-1',
      randomUUID(),
      report([reported(old, { recordedAt: new Date(Date.now() - 30 * 86_400_000).toISOString() })]),
    );
    await manager.resolve('m', old, 'dismiss');
    await expect(applyInventory(old)).rejects.toBeInstanceOf(OperationAbandonedError);
  });

  it('버리는 사이 기기의 같은 키 요청이 먼저 반영되면 버리기가 거절된다', async () => {
    const key = newKey();
    await manager.report('worker-1', randomUUID(), report([reported(key)]));
    let release!: () => void;
    const holding = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const inHandler = new Promise<void>((resolve) => (entered = resolve));
    const request = idempotency.withIdempotency('inbound.simple.v2', key, { key }, async () => {
      entered();
      await holding;
      return { receiptId: key };
    });
    await inHandler;
    const abandon = manager.resolve('m', key, 'abandon');
    // 버리기는 요청이 끝날 때까지 키 잠금에서 기다린다
    const early = await Promise.race([
      abandon.then(
        () => 'done',
        () => 'done',
      ),
      new Promise((r) => setTimeout(() => r('waiting'), 300)),
    ]);
    expect(early).toBe('waiting');
    release();
    await expect(request).resolves.toEqual({ receiptId: key });
    await expect(abandon).rejects.toBeInstanceOf(DeviceWorkVerdictChangedError);
    expect(await verdictOf(key)).toBe('applied');
  });

  it('버리기와 같은 키 요청이 동시에 와도 한쪽만 이긴다', async () => {
    for (let i = 0; i < 15; i++) {
      const key = newKey();
      await manager.report('worker-1', randomUUID(), report([reported(key)]));
      const [request, abandon] = await Promise.allSettled([applyInventory(key), manager.resolve('m', key, 'abandon')]);
      const requestWon = request.status === 'fulfilled';
      const abandonWon = abandon.status === 'fulfilled';
      expect(requestWon !== abandonWon).toBe(true);
      const applied = await db
        .select()
        .from(wmsTables.inventoryIdempotencyRequests)
        .where(eq(wmsTables.inventoryIdempotencyRequests.key, key));
      const locked = await db
        .select()
        .from(wmsTables.abandonedOperationKeys)
        .where(eq(wmsTables.abandonedOperationKeys.operationKey, key));
      expect([applied.length, locked.length]).toEqual(requestWon ? [1, 0] : [0, 1]);
    }
  });
});
