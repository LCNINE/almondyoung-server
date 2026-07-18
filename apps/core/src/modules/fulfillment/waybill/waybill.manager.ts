import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, inventorySchema, inventoryTables } from '../../inventory/schema/inventory.schema';
import { FulfillmentCommandService } from '../services/fulfillment-command.service';
import { HANJIN_CONFIG } from './waybill.tokens';
import type { HanjinConfig } from './carrier/hanjin/hanjin.config';
import type { CarrierCode } from './carrier/carrier-gateway.interface';
import { CarrierGatewayRegistry } from './carrier/carrier-gateway.registry';
import { assembleWaybillRequest, parseRecipient } from './waybill-request.assembler';
import { WaybillIssueMachine } from './waybill-issue.machine';
import { WaybillReader } from './waybill.reader';
import { WaybillRepository } from './waybill.repository';
import { WAYBILL, WAYBILL_DISPATCHABLE_STATUSES } from './waybill.constants';
import type { BatchResultItem, WaybillRow } from './waybill.types';

export interface IssueOpts {
  carrier: CarrierCode;
  expectedManifestVersion: number;
}
export type Actor = { id: string; roles: string[] };

@Injectable()
export class WaybillManager {
  constructor(
    private readonly reader: WaybillReader,
    private readonly repo: WaybillRepository,
    private readonly machine: WaybillIssueMachine,
    private readonly registry: CarrierGatewayRegistry,
    private readonly commands: FulfillmentCommandService,
    @Inject(HANJIN_CONFIG) private readonly config: HanjinConfig,
    @InjectTypedDb<typeof inventorySchema>() private readonly dbService: DbService<typeof inventorySchema>,
  ) {}

  // carrier 발급: pending durable 삽입(idempotent, commands.execute) → tx 밖에서 machine.drive(allocate+register).
  // tx? 를 받지 않는다 — carrier HTTP 를 호출자 tx 에 넣을 수 없다.
  async issueForShipment(
    shipmentId: string,
    opts: IssueOpts,
    idempotencyKey: string,
    actor: Actor,
  ): Promise<WaybillRow> {
    const gateway = this.registry.get(opts.carrier);
    if (!gateway || !gateway.isConfigured()) {
      throw new ConflictError(`${WAYBILL.ERROR.CARRIER_NOT_CONFIGURED}: ${opts.carrier}`);
    }

    const { waybillId, request } = await this.commands
      .execute<{ waybillId: string }>(
        {
          commandType: 'shipment.waybill.issue',
          idempotencyKey,
          canonicalRequest: { actorId: actor.id, shipmentId, ...opts },
        },
        async (trx) => {
          const ctx = await this.reader.loadIssueContext(trx, shipmentId);
          if (ctx.status !== 'planned') {
            throw new ConflictError(`${WAYBILL.ERROR.NOT_DISPATCHABLE}: shipment ${ctx.status}`);
          }
          if (ctx.manifestVersion !== opts.expectedManifestVersion) {
            throw new ConflictError(
              `${WAYBILL.ERROR.STALE_MANIFEST_VERSION}: ${ctx.manifestVersion} != ${opts.expectedManifestVersion}`,
            );
          }
          if (await this.reader.getActiveWaybill(trx, shipmentId)) {
            throw new ConflictError(`${WAYBILL.ERROR.ACTIVE_EXISTS}: ${shipmentId}`);
          }
          const req = assembleWaybillRequest({
            shipmentId,
            recipientSnapshot: ctx.recipientSnapshot,
            lines: ctx.lines,
            config: this.config,
          });
          const row = await this.repo.insertPending(trx, {
            shipmentId,
            source: 'carrier',
            carrier: opts.carrier,
            custOrdNo: req.custOrdNo,
            manifestVersion: ctx.manifestVersion,
            recipientHash: this.reader.recipientHashOf(ctx.recipientSnapshot),
          });
          return { response: { waybillId: row.id }, resourceType: 'waybill', resourceId: row.id };
        },
      )
      .then(async (r) => {
        // 커맨드 밖에서 request 재조립(멱등 replay 시에도 동일). 커맨드 핸들러의 지역변수는 replay 시 실행되지 않아
        // 사용할 수 없다 — drive 는 저장된 pending 행 기준으로 동작하므로 재조립 request 로 충분하다.
        const ctx = await this.dbService.run((trx) => this.reader.loadIssueContext(trx, shipmentId));
        const request = assembleWaybillRequest({
          shipmentId,
          recipientSnapshot: ctx.recipientSnapshot,
          lines: ctx.lines,
          config: this.config,
        });
        return { waybillId: r.waybillId, request };
      });

    return this.machine.drive(waybillId, request);
  }

  // 배치 발급(§10): 버전 인자 없음 — shipment 별 CURRENT manifestVersion 을 그때그때 읽어 issueForShipment 에
  // 넘긴다(입력 시점 버전을 배치가 미리 고정하지 않음). WAYBILL.BATCH_CONCURRENCY bounded 병렬 워커 풀 +
  // BATCH_TIME_BUDGET_MS 시간예산: 데드라인을 넘긴 미착수 shipment 는 조기반환하되 status:'pending',
  // reason:'time-budget-exceeded' 로 기록한다(silent truncation 금지 — 입력 shipmentId 전부가 출력에 나타나야 함).
  // 개별 shipment 실패는 catch 로 흡수해 나머지 배치 진행을 막지 않는다. 반환 순서 = 입력 shipmentIds 순서.
  async issueBatch(
    shipmentIds: string[],
    opts: { carrier: CarrierCode },
    idempotencyKey: string,
    actor: Actor,
  ): Promise<BatchResultItem[]> {
    const deadline = Date.now() + WAYBILL.BATCH_TIME_BUDGET_MS;
    const results = new Map<string, BatchResultItem>();
    const queue = [...shipmentIds];

    const runOne = async (shipmentId: string): Promise<void> => {
      if (Date.now() >= deadline) {
        results.set(shipmentId, { shipmentId, status: 'pending', trackingNo: null, reason: 'time-budget-exceeded' });
        return;
      }
      try {
        const ctx = await this.dbService.run((trx) => this.reader.loadIssueContext(trx, shipmentId));
        const wb = await this.issueForShipment(
          shipmentId,
          { carrier: opts.carrier, expectedManifestVersion: ctx.manifestVersion },
          `${idempotencyKey}:${shipmentId}`,
          actor,
        );
        results.set(shipmentId, { shipmentId, status: wb.status, trackingNo: wb.trackingNo, reason: wb.lastError });
      } catch (e) {
        results.set(shipmentId, {
          shipmentId,
          status: 'failed',
          trackingNo: null,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    };

    // bounded 병렬 워커 풀: 공유 큐를 각 워커가 shift() 로 소진. 큐가 비면 워커 종료.
    const workerCount = Math.min(WAYBILL.BATCH_CONCURRENCY, queue.length);
    const workers = Array.from({ length: workerCount }, async () => {
      for (;;) {
        const next = queue.shift();
        if (next === undefined) return;
        await runOne(next);
      }
    });
    await Promise.all(workers);

    // 방어적 처리: 워커 풀은 정상적으로 큐를 완전히 소진하므로 여기 도달할 항목은 없어야 하지만,
    // 예기치 못한 워커 조기종료로 큐에 미착수건이 남는 경우에도 silent truncation 을 방지한다.
    for (const id of queue) {
      results.set(id, { shipmentId: id, status: 'pending', trackingNo: null, reason: 'time-budget-exceeded' });
    }
    return shipmentIds.map(
      (id) => results.get(id) ?? { shipmentId: id, status: 'pending', trackingNo: null, reason: 'not-processed' },
    );
  }

  // 수기(오프라인) 운송장 등록: 외부 캐리어 호출 없음, 즉시 registered. tx? 를 받는다 — 외부 I/O 가 없어
  // 호출자 tx 안에 자연스럽게 합류할 수 있다(issueForShipment 와의 차이점).
  // 계승: assertRecipientComplete(parseRecipient)는 적용, assertProfileComplete(goodsflow carrierAccountRef)는
  // 적용하지 않는다 — manual 은 캐리어 API 를 쓰지 않으므로 그 계정 완비 여부와 무관하다.
  async registerManual(
    shipmentId: string,
    dto: { carrier: CarrierCode; trackingNo: string; expectedManifestVersion: number; reason?: string },
    idempotencyKey: string,
    actor: Actor,
    tx?: DbTx,
  ): Promise<WaybillRow> {
    const trackingNo = dto.trackingNo.trim();
    if (!trackingNo) throw new BadRequestError(`${WAYBILL.ERROR.NOT_DISPATCHABLE}: trackingNo required`);
    return this.commands.execute<WaybillRow>(
      {
        commandType: 'shipment.waybill.register-manual',
        idempotencyKey,
        canonicalRequest: { actorId: actor.id, shipmentId, ...dto },
      },
      async (trx) => {
        const ctx = await this.reader.loadIssueContext(trx, shipmentId);
        if (ctx.status !== 'planned') {
          throw new ConflictError(`${WAYBILL.ERROR.NOT_DISPATCHABLE}: shipment ${ctx.status}`);
        }
        if (ctx.manifestVersion !== dto.expectedManifestVersion) {
          throw new ConflictError(
            `${WAYBILL.ERROR.STALE_MANIFEST_VERSION}: ${ctx.manifestVersion} != ${dto.expectedManifestVersion}`,
          );
        }
        parseRecipient(ctx.recipientSnapshot); // WAYBILL_RECIPIENT_INCOMPLETE 던짐(반환값은 사용하지 않음)
        if (await this.reader.getActiveWaybill(trx, shipmentId)) {
          throw new ConflictError(`${WAYBILL.ERROR.ACTIVE_EXISTS}: ${shipmentId}`);
        }
        let row: WaybillRow;
        try {
          row = await this.repo.insertManualRegistered(trx, {
            shipmentId,
            carrier: dto.carrier,
            trackingNo,
            manifestVersion: ctx.manifestVersion,
            recipientHash: this.reader.recipientHashOf(ctx.recipientSnapshot),
          });
        } catch (e) {
          if (isUniqueViolation(e)) throw new ConflictError(`${WAYBILL.ERROR.TRACKING_EXISTS}: ${trackingNo}`);
          throw e;
        }
        return { response: row, resourceType: 'waybill', resourceId: row.id };
      },
      tx,
    );
  }

  // 발송 전 로컬 취소. 외부 캐리어 호출 없음 — used(이미 사용) 또는 shipment 가 발송 이후 상태면 거부.
  // 순서 중요: used/발송이후 체크가 !== 'registered' 체크보다 먼저 — used 는 ALREADY_DISPATCHED 로 보고해야 하고
  // NOT_VOIDABLE 로 뭉뚱그리면 안 된다(브리프 명시).
  async void(
    waybillId: string,
    dto: { reason: string },
    idempotencyKey: string,
    actor: Actor,
    tx?: DbTx,
  ): Promise<WaybillRow> {
    return this.commands.execute<WaybillRow>(
      {
        commandType: 'shipment.waybill.void',
        idempotencyKey,
        canonicalRequest: { actorId: actor.id, waybillId, ...dto },
      },
      async (trx) => {
        const wb = await this.repo.findById(trx, waybillId);
        if (!wb) throw new NotFoundError(`${WAYBILL.ERROR.NOT_FOUND}: ${waybillId}`);
        const [shipment] = await trx
          .select({ status: inventoryTables.shipments.status })
          .from(inventoryTables.shipments)
          .where(eq(inventoryTables.shipments.id, wb.shipmentId))
          .limit(1);
        if (wb.status === 'used' || (shipment && ['shipped', 'in_transit', 'delivered'].includes(shipment.status))) {
          throw new ConflictError(`${WAYBILL.ERROR.ALREADY_DISPATCHED}: ${waybillId}`);
        }
        if (wb.status !== 'registered') {
          throw new ConflictError(`${WAYBILL.ERROR.NOT_VOIDABLE}: ${waybillId} is ${wb.status}`);
        }
        const ok = await this.repo.casToVoided(trx, waybillId, new Date());
        if (!ok) throw new ConflictError(`${WAYBILL.ERROR.NOT_VOIDABLE}: ${waybillId} changed concurrently`);
        const row = await this.repo.findById(trx, waybillId);
        // waybills 는 hard-delete 경로가 없다 — 방금 CAS 로 성공적으로 voided 처리한 같은 트랜잭션 안에서
        // 재조회이므로 undefined 일 수 없다. findById 시그니처가 넓어(단건 조회 재사용) 여기서만 좁힌다.
        return { response: row as WaybillRow, resourceType: 'waybill', resourceId: waybillId };
      },
      tx,
    );
  }

  // recall 전용: 발송된(used) 운송장을 voided 로 되돌린다. 일반 void 의 WAYBILL_ALREADY_DISPATCHED
  // strict 가드를 recall 스코프에서만 우회한다(spec §9.1·§12.2). tx-local — carrier HTTP 없음.
  async voidForRecall(
    shipmentId: string,
    dto: { reason: string },
    idempotencyKey: string,
    actor: Actor,
    tx?: DbTx,
  ): Promise<WaybillRow> {
    return this.commands.execute<WaybillRow>(
      {
        commandType: 'shipment.waybill.void-for-recall',
        idempotencyKey,
        canonicalRequest: { actorId: actor.id, shipmentId, ...dto },
      },
      async (trx) => {
        const active = await this.reader.getActiveWaybill(trx, shipmentId);
        if (!active) throw new NotFoundError(`${WAYBILL.ERROR.NOT_FOUND}: ${shipmentId}`);
        const affected = await this.repo.casUsedToVoided(trx, shipmentId, new Date());
        if (affected !== 1) {
          throw new ConflictError(
            `${WAYBILL.ERROR.NOT_DISPATCHABLE}: voidForRecall affected ${affected} rows for ${shipmentId}`,
          );
        }
        // 방금 voided 로 CAS 한 행은 getActiveWaybill(TERMINAL 제외)에 안 잡히므로 id 로 직접 재조회.
        // void 와 달리 여기서는 undefined 를 throw 로 먼저 좁히므로(위 라인) as WaybillRow 캐스팅이 불필요
        // (@typescript-eslint/no-unnecessary-type-assertion) — narrowing 된 voided 를 그대로 반환한다.
        const voided = await this.repo.findById(trx, active.id);
        if (!voided) throw new Error(`voidForRecall: waybill ${active.id} vanished after CAS`);
        return { response: voided, resourceType: 'waybill', resourceId: active.id };
      },
      tx,
    );
  }

  // 활성 waybill 을 void 후 새로 발급(§11) — 원자적 한 커맨드처럼 호출자에게 노출.
  // carrier I/O 포함(issueForShipment 경유) → tx? 를 받지 않는다.
  async reissue(shipmentId: string, opts: IssueOpts, idempotencyKey: string, actor: Actor): Promise<WaybillRow> {
    const active = await this.dbService.run((trx) => this.reader.getActiveWaybill(trx, shipmentId));
    if (active && active.status === 'registered') {
      await this.void(active.id, { reason: 'reissue' }, `${idempotencyKey}:void`, actor);
    } else if (active && active.status === 'used') {
      // 이미 발송에 쓰인 waybill 은 void 불가 대상과 동일하게 ALREADY_DISPATCHED — ABANDON_NOT_ALLOWED 로
      // 뭉뚱그리면 안 된다(§11, void 의 순서 원칙과 동일한 이유. 최종리뷰 하드닝 #3).
      throw new ConflictError(`${WAYBILL.ERROR.ALREADY_DISPATCHED}: active waybill ${active.id} is used`);
    } else if (active) {
      // pending/allocated 교착 상태의 waybill 은 운영자 전용 abandon 경로로만 해제(§11) — reissue 로 우회 금지.
      throw new ConflictError(
        `${WAYBILL.ERROR.ABANDON_NOT_ALLOWED}: active waybill is ${active.status}; operator abandon required before reissue`,
      );
    }
    return this.issueForShipment(shipmentId, opts, `${idempotencyKey}:issue`, actor);
  }

  // 플랜 3(dispatch) 진입점: 활성 waybill 이 있고 registered/used 이며 carrier+trackingNo 가 채워져 있고
  // 현재 shipment 의 manifestVersion/recipientHash 와 일치해야 통과. externalServiceId 요구는 의도적으로 없음
  // (한진에는 그런 provider service id 개념이 없다 — carrier/manual 두 source 모두 동일 기준으로 통일, §9.1).
  async assertDispatchable(shipmentId: string, tx?: DbTx): Promise<WaybillRow> {
    return this.dbService.run(async (trx) => {
      const [shipment] = await trx
        .select({
          manifestVersion: inventoryTables.shipments.manifestVersion,
          recipientSnapshot: inventoryTables.shipments.recipientSnapshot,
        })
        .from(inventoryTables.shipments)
        .where(eq(inventoryTables.shipments.id, shipmentId))
        .limit(1);
      if (!shipment) throw new NotFoundError(`${WAYBILL.ERROR.SHIPMENT_NOT_FOUND}: ${shipmentId}`);
      const wb = await this.reader.getActiveWaybill(trx, shipmentId);
      if (!wb || !WAYBILL_DISPATCHABLE_STATUSES.some((s) => s === wb.status)) {
        throw new ConflictError(
          `${WAYBILL.ERROR.NOT_DISPATCHABLE}: shipment ${shipmentId} needs one registered waybill`,
        );
      }
      if (!wb.carrier || !wb.trackingNo?.trim()) {
        throw new ConflictError(`${WAYBILL.ERROR.NOT_DISPATCHABLE}: waybill missing carrier or tracking number`);
      }
      if (
        wb.manifestVersion !== shipment.manifestVersion ||
        wb.recipientHash !== this.reader.recipientHashOf(shipment.recipientSnapshot)
      ) {
        throw new ConflictError(`${WAYBILL.ERROR.STALE}: waybill does not match shipment manifest/recipient`);
      }
      return wb;
    }, tx);
  }

  // registered/used → used. casToUsed(Task 4) 의 WHERE 가 {registered, used} 를 모두 매칭하므로
  // used→used 재호출도 count 1 로 통과(멱등). 매칭 0행(활성 waybill 없음/이미 종료)이면 엄격하게 예외.
  //
  // 중요(seam, 최종리뷰 하드닝 #1): markUsed 는 manifest/recipient staleness 를 재검증하지 않는다 —
  // 그 검증은 assertDispatchable 의 책임이다. 호출자(플랜 3 dispatch)는 반드시 같은 트랜잭션 안에서
  // assertDispatchable(shipmentId, tx) 를 먼저 호출한 직후 markUsed(shipmentId, tx) 를 호출해야 한다.
  // 이 순서를 어기면(assertDispatchable 없이 markUsed 만 호출) stale waybill 이 그대로 used 처리될 수 있다.
  async markUsed(shipmentId: string, tx?: DbTx): Promise<void> {
    await this.dbService.run(async (trx) => {
      const affected = await this.repo.casToUsed(trx, shipmentId);
      if (affected !== 1) {
        throw new ConflictError(
          `${WAYBILL.ERROR.NOT_DISPATCHABLE}: markUsed affected ${affected} rows for ${shipmentId}`,
        );
      }
    }, tx);
  }

  async getActiveWaybill(shipmentId: string, tx?: DbTx): Promise<WaybillRow | null> {
    const wb = await this.dbService.run((trx) => this.reader.getActiveWaybill(trx, shipmentId), tx);
    return wb ?? null;
  }
}

// drizzle-orm 0.44.x 는 driver 에러를 DrizzleQueryError 로 감싼다 — 실제 postgres.js PostgresError(code,
// constraint_name)는 최상위가 아니라 `.cause` 체인에 있다(Task 1 의 waybill.constraints.integration.spec.ts
// expectConstraintViolation 과 동일 이슈). 최상위 `.code` 만 보면 여기서 잡히지 않고 500 으로 새어나간다 —
// 최대 5단계까지 `.cause` 를 따라 내려가며 unique_violation(23505) 을 찾는다.
function isUniqueViolation(e: unknown): boolean {
  let current: unknown = e;
  for (let depth = 0; current != null && depth < 5; depth += 1) {
    const row = current as { code?: string; cause?: unknown };
    if (row.code === '23505') return true;
    current = row.cause;
  }
  return false;
}
