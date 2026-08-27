import { Injectable, Logger } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { eq, ne, and, gt, inArray } from 'drizzle-orm';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import {
  CreatePurchaseOrderDto,
  UpdatePurchaseOrderLinesDto,
  CreatePurchaseOrderFromCartDto,
  PurchaseOrderResponse,
} from '../dto/purchase-order.dto';
import { CancelPurchaseOrderDto } from '../dto/purchase-order/cancel-purchase-order.dto';
import { OrderPurchaseOrderLineDto, MarkLineUnavailableDto } from '../dto/purchase-order/execute-line.dto';
import { InboundService } from '../../inbound/services/inbound.service';
import { isTerminal } from './purchase-order-closure.rules';
import { PurchaseOrderReader } from './purchase-order.reader';

/**
 * 발주의 검증·비즈니스 로직·DB 쓰기가 전부 여기 산다.
 *
 * 🔴 **잠금 순서 불변식: PO 행 → 라인(`purchase_order_lines`) 행. 어느 경로든 이
 * 순서로만 잠근다.** "라인" 은 발주 라인(`purchase_order_lines`)만 가리킨다 —
 * 입고 아이템(`inbound_plan_items`)은 다른 테이블이고 다른 규칙을 따른다: 취소
 * (`cancelPurchaseOrder`)가 읽는 것은 후자이며, 그건 잠그지 않고 MVCC 스냅샷으로만
 * 읽는다(§ 아래 해당 메서드 주석 참조). 이 파일에 발주 쓰기를 추가하는 편집은 PO
 * 행을 먼저 잡는다. 순서가 뒤집히면 두 경로가 만나는 순간 Postgres 가 ABBA 교착으로
 * 한쪽을 40P01 로 죽이고, 그건 도메인 예외가 아니라 드라이버 에러라 409 가 아니라
 * **500** 으로 나간다. 취득 지점 3곳에 테스트가 없고 이 주석만이 방어선이다 —
 * 지우지 말 것.
 *
 * 경계는 ADR-0032 가 소유한다:
 * - 발주는 공급사 → 출발 창고 입고까지만 소유하고 거기서 종결한다.
 * - `inbound/` 로 나가는 호출은 `ensurePlanForPurchaseOrder` · `addInboundPlanItems` 둘뿐이다.
 *   라인이 살아있는 동안의 헤더 상태(`created`/`confirmed`)는 `refreshHeaderStatus` 로
 *   라인에서만 파생된다.
 * - 역방향(계획 종결 → 발주 종결) 통보는 존재하되 `PurchaseOrderClosurePort` 를 통해서만
 *   들어온다(`shared/ports/purchase-order-closure.port.ts`) — **호출 방향**은
 *   inbound → procurement 지만 **모듈 의존 방향**은 그대로 procurement → inbound
 *   한쪽이다. 이 포트를 우회해 `inbound/` 가 여기 메서드를 직접 부르게 하거나, 여기서
 *   `inbound/` 내부를 아는 새 파생 경로를 만들지 않는다 — 그 이유는 포트 파일이 설명한다.
 * - `warehouse-transfer/` 를 부르지 않는다. 선적은 이동 지시서가 독립 소유한다.
 *
 * 조회는 `PurchaseOrderReader` 가 소유한다 — 쓰기 후 응답을 만들 때 그 리더를 부른다.
 */
@Injectable()
export class PurchaseOrderManager {
  private readonly logger = new Logger(PurchaseOrderManager.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly inboundService: InboundService,
    private readonly reader: PurchaseOrderReader,
  ) {}

  /**
   * 발주 생성
   */
  async createPurchaseOrder(createDto: CreatePurchaseOrderDto, tx?: DbTx): Promise<PurchaseOrderResponse> {
    return this.dbService.run(async (trx) => {
      // 임시: 창고 라우팅 로직 (나중에 DTO로 받도록 개선)
      const destinationWarehouseId = createDto.destinationWarehouseId;
      const sourceWarehouseId = await this.getSupplierDefaultWarehouseId(createDto.supplierId, trx);
      const requiresTransfer = sourceWarehouseId !== destinationWarehouseId;

      // 발주 헤더 생성
      const [purchaseOrder] = await trx
        .insert(wmsTables.purchaseOrders)
        .values({
          type: createDto.type,
          supplierId: createDto.supplierId,
          status: 'created',
          sourceWarehouseId: sourceWarehouseId,
          destinationWarehouseId: destinationWarehouseId,
          requiresTransfer: requiresTransfer,
        })
        .returning();

      // 발주 라인 생성.
      //
      // 생성 시점의 도착예정일은 헤더가 아니라 **모든 라인의 기본 ETA** 다. 라인을
      // 실제로 발주할 때 다른 날짜를 주면 그 라인만 갱신된다(executeLineOrder 의
      // `dto.expectedArrival ?? line.expectedArrival`). createDto.expectedArrival 은
      // IsCalendarDateConstraint 를 통과한 'YYYY-MM-DD' 라 date 컬럼에 그대로 넣는다 —
      // new Date() 왕복은 UTC 로 옮겨 달력 하루를 민다.
      const purchaseOrderLines = await trx
        .insert(wmsTables.purchaseOrderLines)
        .values(
          createDto.lines.map((line) => ({
            poId: purchaseOrder.id,
            skuId: line.skuId,
            quantity: line.quantity,
            unitPrice: line.unitPrice || null,
            expectedArrival: createDto.expectedArrival ?? null,
          })),
        )
        .returning();

      this.logger.log(`Created purchase order ${purchaseOrder.id} with ${purchaseOrderLines.length} lines`);

      return this.reader.findById(purchaseOrder.id, trx);
    }, tx);
  }

  /**
   * 장바구니에서 발주 생성
   */
  async createPurchaseOrderFromCart(
    createDto: CreatePurchaseOrderFromCartDto,
    userId: string,
    tx?: DbTx,
  ): Promise<PurchaseOrderResponse> {
    return this.dbService.run(async (trx) => {
      const cartItems = await trx
        .select({
          id: wmsTables.purchaseOrderCart.id,
          skuId: wmsTables.purchaseOrderCart.skuId,
          quantity: wmsTables.purchaseOrderCart.quantity,
          type: wmsTables.purchaseOrderCart.type,
        })
        .from(wmsTables.purchaseOrderCart)
        .where(
          and(
            inArray(wmsTables.purchaseOrderCart.id, createDto.cartItemIds),
            eq(wmsTables.purchaseOrderCart.createdBy, userId),
          ),
        );

      if (cartItems.length !== createDto.cartItemIds.length) {
        throw new BadRequestError("Some cart items not found or you don't have permission to access them");
      }

      const types = [...new Set(cartItems.map((item) => item.type))];
      if (types.length > 1) {
        throw new BadRequestError('All cart items must have the same purchase order type');
      }

      const destinationWarehouseId = createDto.destinationWarehouseId;
      const sourceWarehouseId = await this.getSupplierDefaultWarehouseId(createDto.supplierId, trx);
      const requiresTransfer = sourceWarehouseId !== destinationWarehouseId;

      const [purchaseOrder] = await trx
        .insert(wmsTables.purchaseOrders)
        .values({
          type: types[0],
          supplierId: createDto.supplierId,
          status: 'created',
          sourceWarehouseId,
          destinationWarehouseId,
          requiresTransfer,
        })
        .returning();

      // 도착예정일은 헤더가 아니라 라인이 갖는다(createPurchaseOrder 주석 참조).
      await trx.insert(wmsTables.purchaseOrderLines).values(
        cartItems.map((item) => ({
          poId: purchaseOrder.id,
          skuId: item.skuId,
          quantity: item.quantity,
          unitPrice: null,
          expectedArrival: createDto.expectedArrival ?? null,
        })),
      );

      await trx
        .delete(wmsTables.purchaseOrderCart)
        .where(inArray(wmsTables.purchaseOrderCart.id, createDto.cartItemIds));

      this.logger.log(
        `Created purchase order ${purchaseOrder.id} from ${cartItems.length} cart items for user ${userId}`,
      );

      return this.reader.findById(purchaseOrder.id, trx);
    }, tx);
  }

  /**
   * 라인 하나를 실제로 발주했다고 기록한다.
   *
   * 실행 순간 수량·단가·도착예정일이 확정된다. 요청 수량(`quantity`)은 덮어쓰지 않는다 —
   * 요청 10 / 실발주 6 이 둘 다 남아야 "왜 4개가 비었나" 를 나중에 답할 수 있다.
   * 계획은 **첫 실행에서** 생긴다. 발주서 생성 시점이 아니다 — 아직 주문 안 했으니
   * 입고 예정도 없다.
   */
  async orderLine(
    poId: string,
    skuId: string,
    dto: OrderPurchaseOrderLineDto,
    userId: string,
    tx?: DbTx,
  ): Promise<PurchaseOrderResponse> {
    return this.dbService.run(async (trx) => {
      await this.executeLineOrder(trx, poId, skuId, dto, userId);
      await this.refreshHeaderStatus(trx, poId);
      return this.reader.findById(poId, trx);
    }, tx);
  }

  /** 라인을 끝내 발주하지 못했다고 종결한다. 되살릴 수 없다 — 다시 사려면 새 발주서를 만든다. */
  async markLineUnavailable(
    poId: string,
    skuId: string,
    dto: MarkLineUnavailableDto,
    userId: string,
    tx?: DbTx,
  ): Promise<PurchaseOrderResponse> {
    return this.dbService.run(async (trx) => {
      // PO 행 → 라인 행 순서로만 잠근다 (executeLineOrder 와 같은 순서).
      await this.lockPurchaseOrderForLineExecution(trx, poId);
      await this.loadRequestedLine(trx, poId, skuId);

      await trx
        .update(wmsTables.purchaseOrderLines)
        .set({
          status: 'unavailable',
          unavailableReason: dto.reason ?? null,
          // orderedAt/orderedBy 는 "발주한 시각" 이 아니라 라인 실행이 끝난 시각·사람이다.
          // 종결도 실행이므로 누가 언제 끊었는지 같은 자리에 남긴다.
          orderedAt: new Date(),
          orderedBy: userId,
        })
        .where(and(eq(wmsTables.purchaseOrderLines.poId, poId), eq(wmsTables.purchaseOrderLines.skuId, skuId)));

      await this.refreshHeaderStatus(trx, poId);
      return this.reader.findById(poId, trx);
    }, tx);
  }

  /**
   * 발주를 취소한다. 파생이 아니라 **사람의 결정**이므로 전용 종결 경로다.
   *
   * 입고가 한 건이라도 있으면 거부한다 — 이미 받은 물건이 있는 발주는 취소가 아니라
   * 잔량 포기(잎 종결)로 닫는다(#724 항목 7 스펙 §2.1·§2.2).
   * 전 라인이 `unavailable` 인 발주도 자동으로 취소되지 않는다. 닫을지는 사람이 정한다.
   *
   * 🔴 잠금 순서: PO 행부터 잡는다. 라인은 읽지 않고 아이템만 읽는다.
   */
  async cancelPurchaseOrder(
    poId: string,
    dto: CancelPurchaseOrderDto,
    userId: string,
    tx?: DbTx,
  ): Promise<PurchaseOrderResponse> {
    return this.dbService.run(async (trx) => {
      const [header] = await trx
        .select({ status: wmsTables.purchaseOrders.status })
        .from(wmsTables.purchaseOrders)
        .where(eq(wmsTables.purchaseOrders.id, poId))
        .limit(1)
        .for('update');
      if (!header) throw new NotFoundError(`Purchase order not found: ${poId}`);

      if (isTerminal(header.status)) {
        throw new ConflictError(`Purchase order is already ${header.status}; it cannot be cancelled`);
      }

      // 🔴 알려진 경합(고의로 안 막음, 판정 완료): 여기서 계획/아이템 행을 잠그지 않는다.
      // 이 SELECT 는 MVCC 스냅샷 읽기라 다른 트랜잭션의 미커밋 입고를 기다리지 않고
      // 그냥 못 본다 — 그 입고가 우리가 위에서 잡은 PO 행 락과 무관하게 진행 중이면,
      // 이 취소는 "입고 없음" 으로 읽고 통과한 뒤 그 입고가 뒤이어 커밋될 수 있다.
      // 막으려면 취소도 계획/아이템 행을 잠가야 하는데, 취소는 PO 를 먼저 잡으므로
      // 그러면 순서가 `PO → 계획` 이 되어 입고 경로(`아이템 → 계획 → PO`)와 ABBA
      // 교착이 생긴다 — 그 대가가 이 경합보다 나쁘다고 판단했다(도메인 예외가 아니라
      // 40P01 드라이버 에러 → 500). 이 경합이 실현되면 `cancelled` 상태에
      // `received_qty > 0` 인 아이템이 남는다 — 조용하지 않고 눈에 보이며, 재고의
      // 진실은 어차피 stock_ledgers 원장이 갖는다. 그래서 여기서는 잠그지 않는다.
      const [received] = await trx
        .select({ id: wmsTables.inboundPlanItems.id })
        .from(wmsTables.inboundPlanItems)
        .innerJoin(wmsTables.inboundPlans, eq(wmsTables.inboundPlans.id, wmsTables.inboundPlanItems.planId))
        .where(
          and(eq(wmsTables.inboundPlans.linkedPurchaseOrderId, poId), gt(wmsTables.inboundPlanItems.receivedQty, 0)),
        )
        .limit(1);
      if (received) {
        throw new ConflictError('Purchase order already has receipts; close the remaining items instead');
      }

      await trx
        .update(wmsTables.purchaseOrders)
        .set({
          status: 'cancelled',
          cancelledReason: dto.reason,
          cancelledAt: new Date(),
          cancelledBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(wmsTables.purchaseOrders.id, poId));

      return this.reader.findById(poId, trx);
    }, tx);
  }

  /**
   * 라인 실행의 알맹이. 라인별 실행(`orderLine`)과 일괄 확정이 **둘 다 여기로 온다** —
   * 계획 아이템을 쓰는 자리를 하나로 두기 위해서다.
   *
   * 헤더 status 갱신과 응답 조립은 호출자가 한다. 일괄 확정은 라인마다 헤더를 다시
   * 계산할 이유가 없고(마지막에 한 번이면 된다), 응답도 한 번만 필요하다.
   */
  private async executeLineOrder(
    tx: DbTx,
    poId: string,
    skuId: string,
    dto: OrderPurchaseOrderLineDto,
    userId: string,
  ): Promise<void> {
    // 라인 락보다 **먼저** PO 행을 잠근다 (아래 helper 의 락 순서 불변식 참고).
    await this.lockPurchaseOrderForLineExecution(tx, poId);
    const line = await this.loadRequestedLine(tx, poId, skuId);
    if (dto.orderedQty < 1) {
      // class-validator 가 이미 막지만, 서비스를 직접 부르는 경로(스펙·다른 서비스)를 위해
      // 여기서도 막는다. 0 은 unavailable 과 의미가 겹친다.
      throw new BadRequestError('orderedQty must be at least 1; use the unavailable action instead');
    }

    // 실행자가 날짜를 안 주면 라인이 이미 들고 있던 값이 진실이다. `?? null` 로 덮으면
    // 마이그레이션이 헤더에서 백필해 둔 살아있는 ETA 가 조용히 사라진다 —
    // 옆의 unitPrice 와 같은 모양이어야 한다.
    const effectiveArrival = dto.expectedArrival ?? line.expectedArrival;

    await tx
      .update(wmsTables.purchaseOrderLines)
      .set({
        status: 'ordered',
        orderedQty: dto.orderedQty,
        unitPrice: dto.unitPrice ?? line.unitPrice,
        expectedArrival: effectiveArrival,
        orderedAt: new Date(),
        orderedBy: userId,
      })
      .where(and(eq(wmsTables.purchaseOrderLines.poId, poId), eq(wmsTables.purchaseOrderLines.skuId, skuId)));

    const plan = await this.inboundService.ensurePlanForPurchaseOrder(poId, tx);
    await this.inboundService.addInboundPlanItems(
      {
        planId: plan.id,
        items: [{ skuId, expectedQty: dto.orderedQty, expectedDate: effectiveArrival ?? undefined }],
      },
      tx,
    );
  }

  /**
   * 라인을 건드리기 전에 발주 헤더를 잠그고 상태를 확인한다.
   *
   * **락 순서 불변식: PO 행 → 라인 행. 어느 경로든 이 순서로만 잠근다.**
   * 일괄 확정은 헤더 UPDATE(와 ensurePlanForPurchaseOrder 의 FOR UPDATE)로 PO 행을
   * 먼저 잡고 루프에서 라인을 잠근다. 라인별 실행이 라인을 먼저 잠그면 순서가 뒤집혀
   * (ABBA) 두 경로가 만나는 순간 Postgres 가 한쪽을 40P01 로 죽인다 — 그건 도메인
   * 예외가 아니라 드라이버 에러라 409 가 아니라 **500** 으로 나간다. 그래서 라인별
   * 경로도 여기서 PO 행부터 잡는다.
   */
  private async lockPurchaseOrderForLineExecution(tx: DbTx, poId: string): Promise<void> {
    const [po] = await tx
      .select({ status: wmsTables.purchaseOrders.status })
      .from(wmsTables.purchaseOrders)
      .where(eq(wmsTables.purchaseOrders.id, poId))
      .limit(1)
      .for('update');

    if (!po) throw new NotFoundError(`Purchase order not found: ${poId}`);
    // 종결(received/cancelled)은 입고 경로/사람이 소유한 상태다(스펙 §5 헤더 status
    // 파생표). 여기서 막지 않으면 라인 실행이 계획에 아이템을 더 붙여
    // inbound_pending_qty 를 부풀리고, refreshHeaderStatus 는 종결 상태를 보면 일찍
    // 반환하므로 그 뒤로는 아무것도 이 상태를 되돌리지 못한다. drizzle enum 컬럼은
    // 문자열 유니온이라 TS enum 멤버가 아니라 리터럴로 비교한다(no-unsafe-enum-comparison).
    if (isTerminal(po.status)) {
      throw new BadRequestError(`Cannot execute purchase order lines with status: ${po.status}`);
    }
  }

  /**
   * 아직 실행되지 않은 라인만 내준다. 종결된 라인은 재실행도 번복도 안 된다.
   *
   * `FOR UPDATE` 로 **라인 행**을 잠근다 — 라인이 실행의 단위이므로 락도 라인에 건다.
   * 락이 없으면 같은 라인을 동시에 실행하는 두 트랜잭션이 둘 다 상태 검사를 통과해
   * 계획 아이템을 두 번 꽂는다(`inbound_plan_items` 에는 (plan_id, sku_id) 유니크가
   * 없어 DB 가 막아주지 않는다). 뒤에 온 쪽은 여기서 앞선 트랜잭션의 커밋을 기다렸다가
   * 'ordered' 를 보고 409 로 끝난다.
   */
  private async loadRequestedLine(
    tx: DbTx,
    poId: string,
    skuId: string,
  ): Promise<{ status: string; unitPrice: number | null; expectedArrival: string | null }> {
    const [line] = await tx
      .select({
        status: wmsTables.purchaseOrderLines.status,
        unitPrice: wmsTables.purchaseOrderLines.unitPrice,
        expectedArrival: wmsTables.purchaseOrderLines.expectedArrival,
      })
      .from(wmsTables.purchaseOrderLines)
      .where(and(eq(wmsTables.purchaseOrderLines.poId, poId), eq(wmsTables.purchaseOrderLines.skuId, skuId)))
      .limit(1)
      .for('update');

    if (!line) throw new NotFoundError(`Purchase order line not found: ${poId}/${skuId}`);
    if (line.status !== 'requested') {
      throw new ConflictError(`Line already ${line.status}: ${poId}/${skuId}`);
    }
    return line;
  }

  /**
   * 헤더 `status` 를 라인에서 다시 계산한다.
   *
   * 진실은 라인이고 컬럼은 캐시다. `partially_ordered` 같은 새 enum 값은 넣지 않는다 —
   * "부분" 은 라인이 이미 표현하고, enum 값 추가는 admin-web 선배포를 요구해 단계만 늘린다.
   * 종결 2개(`received`/`cancelled`)는 각각 입고 경로/사람이 소유하므로 여기서
   * 건드리지 않는다(조기 반환이 `isTerminal` 로 둘 다 막는다).
   */
  private async refreshHeaderStatus(tx: DbTx, poId: string): Promise<void> {
    const [header] = await tx
      .select({ status: wmsTables.purchaseOrders.status })
      .from(wmsTables.purchaseOrders)
      .where(eq(wmsTables.purchaseOrders.id, poId))
      .limit(1);
    // 종결 2개(received/cancelled)는 파생의 밖에 있다. 파생이 이 둘을 되돌리면
    // 취소된 발주가 라인 실행으로 살아난다.
    if (!header || isTerminal(header.status)) return;

    const [pending] = await tx
      .select({ skuId: wmsTables.purchaseOrderLines.skuId })
      .from(wmsTables.purchaseOrderLines)
      .where(and(eq(wmsTables.purchaseOrderLines.poId, poId), eq(wmsTables.purchaseOrderLines.status, 'requested')))
      .limit(1);

    const next = pending ? 'created' : 'confirmed';
    if (next === header.status) return;

    await tx
      .update(wmsTables.purchaseOrders)
      .set({ status: next, updatedAt: new Date() })
      .where(eq(wmsTables.purchaseOrders.id, poId));
  }

  /**
   * 발주 라인 수정 (created/confirmed 모두 가능)
   * - created: 자유롭게 수정 가능
   * - confirmed: 종결된(ordered/unavailable) 라인은 그대로 두고, 아직 requested 인
   *   라인만 갈아끼운다. 종결된 라인은 이미 계획에 아이템으로 붙어 있어 요청 수량을
   *   바꾸면 실행 기록(status/ordered_qty/ordered_at/ordered_by/expected_arrival/
   *   unavailable_reason)과 어긋난다.
   */
  async updatePurchaseOrderLines(
    poId: string,
    updateDto: UpdatePurchaseOrderLinesDto,
    tx?: DbTx,
  ): Promise<PurchaseOrderResponse> {
    return this.dbService.run(async (trx) => {
      // 1. PO 존재 확인 + 잠금(FOR UPDATE).
      //
      // 아래 4~5 단계가 라인 행을 지웠다 다시 넣고, refreshHeaderStatus 가 그 결과로
      // PO 행을 UPDATE 한다 — 즉 이 메서드는 "라인을 먼저 건드리고 PO 행을 나중에
      // 쓴다". lockPurchaseOrderForLineExecution 옆에 적힌 락 순서 불변식(PO 행 →
      // 라인 행)을 지키려면, 라인을 건드리기 전에 여기서 PO 행부터 잠가야 한다 —
      // 안 그러면 이 메서드만 반대 순서로 잠그는 유일한 경로가 되어, 일괄 확정이나
      // 라인별 실행과 반대 방향으로 맞물리는 순간 Postgres 가 40P01(교착)로 한쪽을
      // 죽인다. 그건 도메인 예외가 아니라 드라이버 에러라 409 가 아니라 500 으로 나간다.
      //
      // lockPurchaseOrderForLineExecution 을 그대로 재사용하지 않는다 — 심사 게이트가
      // 사라진 지금 그 helper 가 하는 일(PO 행 FOR UPDATE + received 거부)은 이 메서드가
      // 필요로 하는 것과 사실상 같아졌다. 그래도 갈아타지 않는 이유는 **메시지**가 다르기
      // 때문이다 — 그 helper 는 "Cannot execute purchase order lines with status: ..." 를
      // 던지는데, 이 메서드는 라인 수정 엔드포인트에 맞는 "Cannot modify purchase order
      // lines after fully received" 를 유지해야 한다. 예외 타입은 둘 다 BadRequestError 로
      // 통일됐다(#724 항목 5-c). 합치는 건 API 응답 메시지를 바꾸는 일이라 범위 밖이다.
      //
      // ⚠️ 이 거부는 의미상 409(ConflictError)에 가깝지만 지금 400 이고, 바꾸면 API 계약
      // 변경이라 그대로 둔다 — #745.
      const [po] = await trx
        .select()
        .from(wmsTables.purchaseOrders)
        .where(eq(wmsTables.purchaseOrders.id, poId))
        .limit(1)
        .for('update');

      if (!po) {
        throw new NotFoundError(`Purchase order ${poId} not found`);
      }

      // 2. 종결(received/cancelled) 상태는 수정 불가. inventory 전체에서 남았던
      //    유일한 `=== 'received'` 비교였다 — cancelled 발주가 이 문을 통과해 라인이
      //    조용히 바뀌었다(최종 전체 리뷰 발견 I1). refreshHeaderStatus 는 isTerminal
      //    로 조기 반환하므로 헤더 status 는 cancelled 로 남은 채 라인만 바뀐다.
      if (isTerminal(po.status)) {
        throw new BadRequestError('Cannot modify purchase order lines after fully received');
      }

      // 3. 종결된 라인(ordered/unavailable)은 건드리지 않는다. 그 라인은 이미 계획에
      //    아이템으로 붙어 있고, 요청 수량을 바꾸면 실행 기록과 어긋난다.
      const closed = await trx
        .select({ skuId: wmsTables.purchaseOrderLines.skuId })
        .from(wmsTables.purchaseOrderLines)
        .where(and(eq(wmsTables.purchaseOrderLines.poId, poId), ne(wmsTables.purchaseOrderLines.status, 'requested')));
      const closedSkuIds = new Set(closed.map((l) => l.skuId));

      // 4. 아직 요청 상태인 라인만 갈아끼운다.
      await trx
        .delete(wmsTables.purchaseOrderLines)
        .where(and(eq(wmsTables.purchaseOrderLines.poId, poId), eq(wmsTables.purchaseOrderLines.status, 'requested')));

      const incoming = updateDto.lines.filter((line) => !closedSkuIds.has(line.skuId));
      if (incoming.length > 0) {
        await trx.insert(wmsTables.purchaseOrderLines).values(
          incoming.map((line) => ({
            poId,
            skuId: line.skuId,
            quantity: line.quantity,
            unitPrice: line.unitPrice ?? null,
          })),
        );
      }

      // 5. 계획 아이템 재동기화는 없다. 종결된 라인만 계획에 붙어 있고 그 라인은 위에서
      //    건드리지 않았으므로 아이템도 그대로다. 예전 syncInboundPlanItems 는 pending
      //    아이템만 지우고 새 라인 전체를 재삽입해서, 이미 입고된 수량을 pending 으로
      //    한 벌 더 만들었다(진단 문서 ④). 라인 생명주기가 생긴 지금은 재동기화할
      //    대상 자체가 없다 — 종결 라인은 계획에 붙었고 건드리지 않으니까.
      await this.refreshHeaderStatus(trx, poId);

      this.logger.log(`Updated ${updateDto.lines.length} lines for PO ${poId}`);

      return this.reader.findById(poId, trx);
    }, tx);
  }

  /**
   * 발주 유형에 따른 입고 창고 ID 반환 (source)
   */
  private async getSupplierDefaultWarehouseId(supplierId: string, tx: DbTx): Promise<string> {
    const [supplier] = await tx
      .select({ defaultWarehouseId: wmsTables.suppliers.defaultWarehouseId })
      .from(wmsTables.suppliers)
      .where(eq(wmsTables.suppliers.id, supplierId))
      .limit(1);
    if (!supplier) {
      throw new BadRequestError(`Supplier with ID ${supplierId} not found`);
    }
    if (!supplier.defaultWarehouseId) {
      // MD 가 발주 화면에서 직접 읽는 문구다. 원시 UUID 와 영어로는 어디를 고쳐야
      // 하는지 알 수 없다 — 라이브 공급사 전원이 이 값이 비어 있어 사실상 발주의
      // 첫 관문이므로, 다음 행동을 문장에 담는다.
      throw new BadRequestError(
        '이 공급처에 입고 창고가 지정되지 않아 발주를 만들 수 없습니다. 공급처 관리에서 입고 창고를 먼저 지정하세요.',
      );
    }
    return supplier.defaultWarehouseId;
  }
}
