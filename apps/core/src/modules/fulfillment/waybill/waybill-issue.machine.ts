import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, inventorySchema } from '../../inventory/schema/inventory.schema';
import { CarrierError, type RetryAfter, type WaybillRequest } from './carrier/carrier-gateway.interface';
import { CarrierGatewayRegistry } from './carrier/carrier-gateway.registry';
import { WaybillRepository } from './waybill.repository';
import { WAYBILL } from './waybill.constants';
import type { WaybillRow } from './waybill.types';

@Injectable()
export class WaybillIssueMachine {
  constructor(
    private readonly repo: WaybillRepository,
    private readonly registry: CarrierGatewayRegistry,
    @InjectTypedDb<typeof inventorySchema>() private readonly dbService: DbService<typeof inventorySchema>,
  ) {}

  // 저장된 waybill 행을 최종상태(registered|failed|abandoned|allocated/pending-정지)까지 진행.
  // carrier HTTP 는 tx 밖에서, 각 전이는 짧은 tx CAS. 재구동 안전(멱등).
  async drive(waybillId: string, req: WaybillRequest, tx?: DbTx): Promise<WaybillRow> {
    let row = await this.dbService.run((trx) => this.repo.findById(trx, waybillId), tx);
    if (!row) throw new Error(`${WAYBILL.ERROR.NOT_FOUND}: ${waybillId}`);

    if (row.status === 'pending') {
      row = await this.driveAllocate(row, req, tx);
      if (row.status !== 'allocated') return row; // failed / abandoned / pending 정지
    }
    if (row.status === 'allocated') {
      row = await this.driveRegister(row, req, tx);
    }
    return row;
  }

  private async driveAllocate(row: WaybillRow, req: WaybillRequest, tx?: DbTx): Promise<WaybillRow> {
    const gateway = this.registry.get(row.carrier);
    if (!gateway || !gateway.isConfigured()) {
      await this.dbService.run(
        (trx) => this.repo.casToFailed(trx, row.id, `${WAYBILL.ERROR.CARRIER_NOT_CONFIGURED}: ${row.carrier}`),
        tx,
      );
      return this.reload(row.id, tx);
    }
    try {
      const { waybillNo, labelData } = await gateway.allocate(req);
      await this.dbService.run((trx) => this.repo.casToAllocated(trx, row.id, waybillNo, labelData), tx);
    } catch (e) {
      // 일시적 거절(ERROR-05 일일한도 / ERROR-06 지역통제): 종료시키지 않고 pending 을 유지한 채
      // 다음 재시도 시각을 적는다. unknown_outcome 과 «다른 카운터»를 쓴다 — 이쪽은 채번이 확실히
      // 안 된 것이라 pending CAP(결과 불명 전용)을 갉아먹으면 안 된다(#914).
      if (e instanceof CarrierError && e.outcome === 'transient_rejection') {
        return this.holdForRetry(row.id, e, 'allocate', tx);
      }
      if (e instanceof CarrierError && e.outcome === 'unknown_outcome') {
        await this.dbService.run(async (trx) => {
          await this.repo.incrementAttempts(trx, row.id);
        }, tx);
        const bumped = await this.reload(row.id, tx);
        if (bumped.attempts >= WAYBILL.PENDING_ATTEMPTS_CAP) {
          await this.dbService.run((trx) => this.repo.casToAbandoned(trx, row.id, 'pending'), tx);
        }
        return this.reload(row.id, tx);
      }
      const code = e instanceof CarrierError ? (e.details.code ?? 'definitive_rejection') : String(e);
      await this.dbService.run((trx) => this.repo.casToFailed(trx, row.id, `allocate ${code}`), tx);
    }
    return this.reload(row.id, tx);
  }

  // pending 유지 + 사유·재시도시각 기록. 전용 CAP 을 넘기면 사유를 명시해 failed 로 «종료»한다 —
  // 탈출구 없는 무한 pending 은 슬롯을 영구히 붙들어 재발급·수기등록을 전부 막는다(#914 문제 2).
  private async holdForRetry(id: string, e: CarrierError, phase: string, tx?: DbTx): Promise<WaybillRow> {
    const code = e.details.code ?? 'transient_rejection';
    const nextAttemptAt = nextAttemptFrom(e.details.retryAfter, new Date());
    const reason = `${phase} ${code}: transient, retry after ${nextAttemptAt.toISOString()}`;
    await this.dbService.run((trx) => this.repo.casToTransientPending(trx, id, reason, nextAttemptAt), tx);
    const held = await this.reload(id, tx);
    if (held.transientAttempts < WAYBILL.TRANSIENT_ATTEMPTS_CAP) return held;
    await this.dbService.run(
      (trx) =>
        this.repo.casToFailed(
          trx,
          id,
          `${phase} ${code}: ${WAYBILL.ERROR.TRANSIENT_CAP_EXCEEDED} (${held.transientAttempts})`,
        ),
      tx,
    );
    return this.reload(id, tx);
  }

  private async driveRegister(row: WaybillRow, req: WaybillRequest, tx?: DbTx): Promise<WaybillRow> {
    const gateway = this.registry.get(row.carrier);
    if (!gateway) throw new Error(`${WAYBILL.ERROR.CARRIER_NOT_CONFIGURED}: ${row.carrier}`);
    if (!row.trackingNo) throw new Error(`${WAYBILL.ERROR.NOT_DISPATCHABLE}: allocated row missing trackingNo`);
    try {
      const outcome = await gateway.register(row.trackingNo, req);
      if (outcome.kind === 'registered' || outcome.kind === 'already_registered') {
        await this.dbService.run((trx) => this.repo.casToRegistered(trx, row.id, new Date()), tx);
      } else {
        await this.dbService.run(
          (trx) => this.repo.casToFailed(trx, row.id, `register rejected: ${outcome.reason}`),
          tx,
        );
      }
    } catch (e) {
      // allocated 단계의 transient 는 unknown_outcome 과 같은 취급이다 — 이미 채번된 wblNo 가 있으므로
      // 어느 쪽이든 「같은 번호로 다시 등록을 시도한다」가 정답이고, pending 처럼 되돌릴 것이 없다.
      // 한진 -103(호출량 초과)은 HanjinApiClient 가 어느 API 에서든 transient_rejection 으로 올린다(#916).
      if (e instanceof CarrierError && (e.outcome === 'unknown_outcome' || e.outcome === 'transient_rejection')) {
        // allocated 는 CAP 없음 — 동일 wblNo 로 재구동(ERROR-09 가 등록 확인). 자동 포기 금지.
        await this.dbService.run(async (trx) => {
          await this.repo.incrementAttempts(trx, row.id);
        }, tx);
        return this.reload(row.id, tx);
      }
      const code = e instanceof CarrierError ? (e.details.code ?? 'definitive_rejection') : String(e);
      await this.dbService.run((trx) => this.repo.casToFailed(trx, row.id, `register ${code}`), tx);
    }
    return this.reload(row.id, tx);
  }

  private async reload(id: string, tx?: DbTx): Promise<WaybillRow> {
    const row = await this.dbService.run((trx) => this.repo.findById(trx, id), tx);
    if (!row) throw new Error(`${WAYBILL.ERROR.NOT_FOUND}: ${id}`);
    return row;
  }
}

/**
 * 캐리어 힌트를 재시도 «시각»으로 환산. 순수함수 — 런타임 TZ 에 의존하지 않는다.
 * `next_day` 는 다음 KST 자정이다(한진 일일 한도가 그때 리셋된다). 한국은 DST 가 없어 고정 +9h 로 계산한다.
 * 런타임 TZ 를 읽는 방식(`toZonedTime`, `Date#getHours`)으로 쓰면 서울 개발머신에서만 통과하고
 * UTC 인 CI·라이브에서 어긋난다.
 */
export function nextAttemptFrom(hint: RetryAfter | undefined, from: Date): Date {
  if (hint?.kind === 'after_ms') return new Date(from.getTime() + hint.ms);
  if (hint?.kind === 'next_day') {
    const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
    const DAY_MS = 24 * 60 * 60 * 1000;
    const kstNow = from.getTime() + KST_OFFSET_MS;
    const kstMidnightAfter = Math.floor(kstNow / DAY_MS) * DAY_MS + DAY_MS;
    return new Date(kstMidnightAfter - KST_OFFSET_MS);
  }
  return new Date(from.getTime() + WAYBILL.TRANSIENT_DEFAULT_BACKOFF_MS);
}
