import { DbService } from '@app/db';
import { BatchControlledStockGuard } from '../../../inventory/core/services/batch-controlled-stock.guard';
import { wmsSchema } from '../../../inventory/schema/inventory.schema';
import { AuditService } from '../../../inventory/shared/services/audit.service';
import { WaybillManager } from '../../waybill/waybill.manager';
import { WaybillReader } from '../../waybill/waybill.reader';
import { WaybillRepository } from '../../waybill/waybill.repository';
import { WaybillService } from '../../waybill/waybill.service';
import { BatchInventorySessionService } from '../batch-inventory-session.service';
import { BoxAllocationManager } from '../box-allocation.manager';
import { BoxWithdrawalService } from '../box-withdrawal.service';
import { FulfillmentInvariantService } from '../fulfillment-invariant.service';
import { ToteLifecycleService } from '../tote-lifecycle.service';

/**
 * 오케스트레이터·계획을 직접 조립하는 스펙용 — 실제 서비스들로 이탈 서비스를 만든다(stateless 라 인스턴스가 따로여도 된다).
 * 캐리어 호출은 이 경로에 없어 stub 이다(simple-outbound-wiring 과 같다).
 */
export function assembleBoxWithdrawal(dbService: DbService<typeof wmsSchema>): BoxWithdrawalService {
  const audit = new AuditService(dbService);
  const waybills = new WaybillService(
    new WaybillManager(
      new WaybillReader(dbService),
      new WaybillRepository(dbService),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      dbService,
    ),
  );
  return new BoxWithdrawalService(
    new FulfillmentInvariantService(),
    new BoxAllocationManager(new BatchInventorySessionService(dbService, audit), new BatchControlledStockGuard()),
    new ToteLifecycleService(dbService),
    waybills,
    audit,
  );
}
