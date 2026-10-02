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
import { ShortPickExitService } from '../short-pick-exit.service';
import { ShipmentReservationService } from '../shipment-reservation.service';
import { FulfillmentProgressService } from '../fulfillment-progress.service';
import { ProductSellableQuantityService } from '../../../inventory/product-sellable-quantity/services/product-sellable-quantity.service';
import { UnifiedReservationService } from '../../../inventory/shared/services/unified-reservation.service';
import { outboxPublisherFor } from '../../outbox/__support__/outbox-publisher.factory';
import { INVENTORY_STREAM } from '@packages/event-contracts/streams';
import { FulfillmentCommandService } from '../fulfillment-command.service';
import { FulfillmentInvariantService } from '../fulfillment-invariant.service';
import { ToteLifecycleService } from '../tote-lifecycle.service';

/**
 * 오케스트레이터·계획을 직접 조립하는 스펙용 — 실제 서비스들로 이탈 서비스를 만든다(stateless 라 인스턴스가 따로여도 된다).
 * 캐리어 호출은 이 경로에 없어 stub 이다(simple-outbound-wiring 과 같다). 취소 이탈의 송장 무효화(void)는 commands 를 탄다.
 */
export function assembleBoxWithdrawal(dbService: DbService<typeof wmsSchema>): BoxWithdrawalService {
  const audit = new AuditService(dbService);
  const waybills = new WaybillService(
    new WaybillManager(
      new WaybillReader(dbService),
      new WaybillRepository(dbService),
      {} as never,
      {} as never,
      new FulfillmentCommandService(dbService),
      {} as never,
      dbService,
    ),
  );
  const invariant = new FulfillmentInvariantService();
  const reservations = new ShipmentReservationService(
    dbService,
    new UnifiedReservationService(
      dbService,
      new ProductSellableQuantityService(dbService as never, outboxPublisherFor(INVENTORY_STREAM, dbService)),
    ),
    new FulfillmentProgressService(),
    invariant,
  );
  return new BoxWithdrawalService(
    invariant,
    new BoxAllocationManager(new BatchInventorySessionService(dbService, audit), new BatchControlledStockGuard()),
    new ToteLifecycleService(dbService),
    waybills,
    audit,
    new ShortPickExitService(reservations, waybills, audit),
  );
}
