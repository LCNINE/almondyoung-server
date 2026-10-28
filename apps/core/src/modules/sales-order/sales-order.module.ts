import { Module } from '@nestjs/common';
import { EventsModule } from '@app/events';

import { CoreInventoryModule } from '../inventory/core/inventory.module';
import { SharedModule } from '../inventory/shared/shared.module';
import { ProductMatchingModule } from '../product-matching/product-matching.module';
import { PrintOrderModule } from '../print-order/print-order.module';
import { LibraryModule } from '../library/library.module';
import { FulfillmentOrderCreationBacklogModule } from '../fulfillment/backlog/fulfillment-order-creation-backlog.module';
import { UnboxedDemandModule } from '../fulfillment/unboxed-demand/unboxed-demand.module';
import { WaybillModule } from '../fulfillment/waybill/waybill.module';

import { SalesOrdersController } from './controllers/sales-orders.controller';
import { SalesOrderAmendmentsController } from './controllers/sales-order-amendments.controller';
import { StoreSalesOrdersController } from './controllers/store-sales-orders.controller';
import { StoreSalesOrderReturnExchangeController } from './controllers/store-return-exchange.controller';
import { AdminReturnExchangeController } from './controllers/admin-return-exchange.controller';
import { OrderEventsConsumer } from './consumers/order-events.consumer';
import { EntrancePasswordCleaner } from './services/entrance-password-cleaner';
import { SalesOrdersService } from './services/sales-orders.service';
import { SalesOrderAmendmentsService } from './services/sales-order-amendments.service';
import { SalesOrderQueryService } from './services/sales-order-query.service';
import { StoreSalesOrdersService } from './services/store-sales-orders.service';
import { StoreReturnExchangeService } from './services/store-return-exchange.service';
import { WalletRefundClient } from './services/wallet-refund.client';
import { CancellationRefundManager } from './cancellation-refund/cancellation-refund.manager';
import { ChannelOrderChangeReader } from './channel-order-change/channel-order-change.reader';
import { ChannelOrderChangeManager } from './channel-order-change/channel-order-change.manager';
import { ChannelAmendmentActionsService } from './channel-order-change/channel-amendment-actions.service';
import { ChannelOrderChangeService } from './channel-order-change/channel-order-change.service';
import { ChannelCancelSettler } from './channel-cancel-request/channel-cancel-settler';
import { ChannelCancelRequestReader } from './channel-cancel-request/channel-cancel-request.reader';
import { ChannelCancelRequestManager } from './channel-cancel-request/channel-cancel-request.manager';
import { ChannelCancelRequestService } from './channel-cancel-request/channel-cancel-request.service';
import { CustomerReturnManager } from './customer-return/customer-return.manager';
import { CustomerReturnService } from './customer-return/customer-return.service';
import { CustomerReturnReader } from './customer-return/customer-return.reader';
import { CustomerReturnReceivingManager } from './customer-return/customer-return-receiving.manager';
import { CustomerReturnSettlementManager } from './customer-return/customer-return-settlement.manager';
import { CustomerReturnCsManager } from './customer-return/customer-return-cs.manager';
import { CustomerReturnSettlementRetryCron } from './customer-return/customer-return-settlement-retry.cron';
import { CustomerReturnPickupManager } from './customer-return/customer-return-pickup.manager';
import { CustomerReturnPickupCron } from './customer-return/customer-return-pickup.cron';
import { CustomerReturnsController } from './customer-return/customer-returns.controller';
import { CustomerReturnReceivingController } from './customer-return/customer-return-receiving.controller';
import { OrderCancellation } from './order-cancellation/order-cancellation';
import { OrderCancellationReader } from './order-cancellation/order-cancellation.reader';
import { INTERNAL_KEY_ENV } from '@app/authorization';
import { SalesOrdersInternalController } from './internal/sales-orders-internal.controller';
import { ReturnEligibilityReader } from './internal/return-eligibility.reader';
import { ReturnEligibilityService } from './internal/return-eligibility.service';
import { SalesOrderLookupReader } from './internal/sales-order-lookup.reader';
import { SalesOrderLookupService } from './internal/sales-order-lookup.service';

@Module({
  imports: [
    // core 의 **소비 정책** 선언 자리 (ADR-0029 §1·§3). 이 앱의 컨슈머는 전부 이 BC 에
    // 있다 — `OrderEventsConsumer` 하나. 구독 토픽·groupId 는 여기 없다: 토픽은 `@On` 에서
    // 도출되고(`startConsumer`), groupId 는 `main.ts` 가 준다. 옛 `forConsumerModule` 은
    // 둘 다 받았지만 **어느 쪽도 쓰지 않았다** — 도출 불가한 사실만 남긴 결과가 이 한 줄이다.
    //
    // 정책은 앱 전체에 하나다. core 는 `forApp` 을 4번 부르는데(inventory · fulfillment ·
    // catalog · 여기) `policy` 를 선언하는 곳은 여기뿐이며, 둘 이상이면 부팅이 거부된다.
    EventsModule.forApp({
      // 소비 스키마 검증 ON (ADR-0029 §8, 플랜 Task 5-C — 이 앱이 첫 번째다).
      //
      // 근거는 샘플링이 아니라 **발행 경로를 전수로 닫은 정적 증명**이다. 이 앱이 구독하는
      // 5개 이벤트는 전부 `orders.events.v1` 이고, 그 토픽의 발행자는 channel-adapter 의
      // order publisher 2벌 + 자체 outbox dispatcher 뿐이며 셋 다 `StreamPublisher.publishEvent`
      // 를 지난다. `publishEvent` 는 envelope 에 원본이 아니라 **zod 가 파싱한 결과**를 싣기
      // 때문에(`stream-publisher.service.ts:123`) 같은 스키마로 다시 검증하면 반드시 통과한다.
      // (`OrderRefundCreated` 는 발행자가 아예 없다.) Task 6-A 이후로는 이 앱만의 논증이
      // 아니라 레포 전체의 불변식이다 — zod 를 우회하는 발행 경로가 하나도 남지 않았다.
      //
      // 이 논증은 `npm run audit:consume-validation -- --gate` 가 상시 재검증한다 — 검증을
      // 켜 둔 앱에 우회 경로가 닿는 이벤트가 새로 생기면 게이트가 exit 1 로 막는다.
      // 남은 노출은 계약 이전에 토픽에 쌓인 옛 메시지뿐이며, 그건 정적으로 알 수 없다.
      policy: { validateOnConsume: true },
    }),

    // OutboxService (Sales Order 이벤트 발행용), InventoryCommandService (반품 도착·검수 원장 — K8 PR6)
    CoreInventoryModule,

    // AuditService, MetricsService
    SharedModule,

    // ProductSkuMappingService (confirm 시 mapping snapshot 생성)
    ProductMatchingModule,

    // LibraryService (OrderCreated(payment-confirmed)/Cancelled 시 디지털 ownership grant/revoke — ADR-0010)
    LibraryModule,

    // OrderCreated 처리 후 출고주문 생성 시도를 durable backlog 로 기록 — ADR-0014
    FulfillmentOrderCreationBacklogModule,

    // 상자 전 취소의 FO·FOI 쓰기 — 판매주문은 수요 감소분만 넘긴다(K7 PR3)
    UnboxedDemandModule,

    // 인쇄 외주 송장·상태 (배송조회·이행 단계에 반영)
    PrintOrderModule,

    // 반품 회수 워커의 한진 게이트웨이·설정(K8 PR9). WaybillModule 은 FulfillmentCommandModule 만 물어 순환이 없다
    WaybillModule,
  ],
  controllers: [
    SalesOrdersController,
    SalesOrderAmendmentsController,
    StoreSalesOrdersController,
    StoreSalesOrderReturnExchangeController,
    AdminReturnExchangeController,
    // 반품 기록 조회·도착·검수(K8 PR6)
    CustomerReturnsController,
    CustomerReturnReceivingController,
    OrderEventsConsumer,
    // 채널 대사(#1016 45번)의 묶음 조회 — 호출자는 channel-adapter
    SalesOrdersInternalController,
  ],
  providers: [
    SalesOrdersService,
    SalesOrderAmendmentsService,
    SalesOrderQueryService,
    StoreSalesOrdersService,
    StoreReturnExchangeService,
    WalletRefundClient,
    // 취소의 환불 기록·실행 — Wallet 을 부르는 취소 쪽 파일은 이것 하나(K7 PR4)
    CancellationRefundManager,

    // 수집 뒤 채널 변경(OrderModified) 반영 — #1016 5번 행
    ChannelOrderChangeReader,
    ChannelOrderChangeManager,
    ChannelOrderChangeService,
    ChannelAmendmentActionsService,

    // 채널 주문 취소 요청 — #1016 35번 행(ADR-0042·0044). core 는 판정·확정·기록·명령, 환불은 채널(정산)
    ChannelCancelRequestReader,
    ChannelCancelSettler,
    ChannelCancelRequestManager,
    ChannelCancelRequestService,
    // 주문 취소 커널 — 고객·운영자 문은 «무엇을 왜 취소하나»만 말한다(K7)
    OrderCancellation,
    OrderCancellationReader,
    // 채널 반품 확정·취소 → 반품 예정 기록(K8 PR5), 도착·검수·정산 명령(K8 PR6 — 원장은 CoreInventoryModule)
    CustomerReturnManager,
    CustomerReturnReader,
    CustomerReturnReceivingManager,
    CustomerReturnSettlementManager,
    CustomerReturnCsManager,
    CustomerReturnSettlementRetryCron,
    // 반품 회수 한진 예약·취소 워커(K8 PR9)
    CustomerReturnPickupManager,
    CustomerReturnPickupCron,
    CustomerReturnService,

    // 채널 대사(#1016 45번)의 묶음 조회 — 호출자는 channel-adapter
    SalesOrderLookupReader,
    SalesOrderLookupService,
    ReturnEligibilityReader,
    ReturnEligibilityService,
    // `SalesOrdersInternalController` 의 InternalKeyGuard 가 읽을 env 이름. core 로 들어오는 서비스 간 호출은 이 키 하나를 쓴다.
    { provide: INTERNAL_KEY_ENV, useValue: 'CORE_INTERNAL_KEY' },

    // 만료된 공동현관 비번 파기 배치. `ScheduleModule` 을 여기서 다시 import 하지 않는다 —
    // 전역으로 이미 떠 있는 단 하나의 `SCHEDULE_ROOT`(CoreInventoryModule 이 import)의
    // ScheduleExplorer 가 discovery 로 이 provider 의 `@Cron` 을 찾아 마운트한다.
    // `ScheduleModule.forRoot()` 를 다시 부르면 Nest 11 이 모듈을 두 벌 만들어 이 앱의
    // 모든 크론이 2회 등록된다 (#599).
    EntrancePasswordCleaner,
  ],
  exports: [
    SalesOrdersService, // Fulfillment BC (cancel, merge 시 SO 상태 변경)
    SalesOrderAmendmentsService,
    SalesOrderQueryService, // Fulfillment BC (FO 생성 시 SO/라인 조회)
    ChannelCancelRequestService, // Fulfillment BC (리컨실러 36번 — 정산 재발행)
    StoreSalesOrdersService, // 와우프레스 발주 어드민 (취소 마무리 뒤 운영자 취소)
  ],
})
export class SalesOrderModule {}
