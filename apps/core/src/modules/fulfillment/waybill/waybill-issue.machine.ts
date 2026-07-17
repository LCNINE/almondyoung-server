import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, inventorySchema } from '../../inventory/schema/inventory.schema';
import { CarrierError, type WaybillRequest } from './carrier/carrier-gateway.interface';
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
      if (e instanceof CarrierError && e.outcome === 'unknown_outcome') {
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
