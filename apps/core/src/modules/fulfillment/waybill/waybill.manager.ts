import { Inject, Injectable } from '@nestjs/common';
import { ConflictError } from '@app/shared';
import { DbService, InjectTypedDb } from '@app/db';
import { inventorySchema } from '../../inventory/schema/inventory.schema';
import { FulfillmentCommandService } from '../services/fulfillment-command.service';
import { HANJIN_CONFIG } from './waybill.tokens';
import type { HanjinConfig } from './carrier/hanjin/hanjin.config';
import type { CarrierCode } from './carrier/carrier-gateway.interface';
import { CarrierGatewayRegistry } from './carrier/carrier-gateway.registry';
import { assembleWaybillRequest } from './waybill-request.assembler';
import { WaybillIssueMachine } from './waybill-issue.machine';
import { WaybillReader } from './waybill.reader';
import { WaybillRepository } from './waybill.repository';
import { WAYBILL } from './waybill.constants';
import type { WaybillRow } from './waybill.types';

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
}
