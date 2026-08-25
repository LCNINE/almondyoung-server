import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { eq, ne, and, inArray, sql, asc, desc, SQL } from 'drizzle-orm';
import {
  CreatePurchaseOrderDto,
  UpdatePurchaseOrderStatusDto,
  UpdatePurchaseOrderLinesDto,
  AddToCartDto,
  UpdateCartItemDto,
  CreatePurchaseOrderFromCartDto,
  PurchaseOrderResponse,
  CartItemResponse,
  StockReorderSuggestion,
  PurchaseOrderStatus,
  PurchaseOrderType,
} from '../dto/purchase-order.dto';
import { OrderPurchaseOrderLineDto, MarkLineUnavailableDto } from '../dto/purchase-order/execute-line.dto';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { TransactionService } from '../../shared/services/transaction.service';
import { SupplierResponseDto } from '../../suppliers/dto/supplier-response.dto';
import { InboundService } from './inbound.service';

@Injectable()
export class PurchaseOrderService {
  private readonly logger = new Logger(PurchaseOrderService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly transactionService: TransactionService,
    private readonly inboundService: InboundService,
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
          expectedArrival: createDto.expectedArrival ? new Date(createDto.expectedArrival) : null,
          status: 'created',
          sourceWarehouseId: sourceWarehouseId,
          destinationWarehouseId: destinationWarehouseId,
          requiresTransfer: requiresTransfer,
        })
        .returning();

      // 발주 라인 생성
      const purchaseOrderLines = await trx
        .insert(wmsTables.purchaseOrderLines)
        .values(
          createDto.lines.map((line) => ({
            poId: purchaseOrder.id,
            skuId: line.skuId,
            quantity: line.quantity,
            unitPrice: line.unitPrice || null,
          })),
        )
        .returning();

      this.logger.log(`Created purchase order ${purchaseOrder.id} with ${purchaseOrderLines.length} lines`);

      return this.getPurchaseOrderById(purchaseOrder.id, trx);
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
        throw new BadRequestException("Some cart items not found or you don't have permission to access them");
      }

      const types = [...new Set(cartItems.map((item) => item.type))];
      if (types.length > 1) {
        throw new BadRequestException('All cart items must have the same purchase order type');
      }

      const destinationWarehouseId = createDto.destinationWarehouseId;
      const sourceWarehouseId = await this.getSupplierDefaultWarehouseId(createDto.supplierId, trx);
      const requiresTransfer = sourceWarehouseId !== destinationWarehouseId;

      const [purchaseOrder] = await trx
        .insert(wmsTables.purchaseOrders)
        .values({
          type: types[0],
          supplierId: createDto.supplierId,
          expectedArrival: createDto.expectedArrival ? new Date(createDto.expectedArrival) : null,
          status: 'created',
          sourceWarehouseId,
          destinationWarehouseId,
          requiresTransfer,
        })
        .returning();

      await trx.insert(wmsTables.purchaseOrderLines).values(
        cartItems.map((item) => ({
          poId: purchaseOrder.id,
          skuId: item.skuId,
          quantity: item.quantity,
          unitPrice: null,
        })),
      );

      await trx
        .delete(wmsTables.purchaseOrderCart)
        .where(inArray(wmsTables.purchaseOrderCart.id, createDto.cartItemIds));

      this.logger.log(
        `Created purchase order ${purchaseOrder.id} from ${cartItems.length} cart items for user ${userId}`,
      );

      return this.getPurchaseOrderById(purchaseOrder.id, trx);
    }, tx);
  }

  /**
   * 발주 상태 업데이트
   *
   * `confirmed` 로의 전이는 "아직 실행 안 된 라인을 전부 지금 발주한 것으로 친다" 는
   * 뜻이다 — 라인별 실행 화면을 쓰지 않는 운영자를 위한 일괄 경로다. 그래서 라인
   * 실행과 **같은 경로**를 지난다(`executeLineOrder`). 두 경로가 각자
   * `inbound_plan_items` 를 쓰면 두 화면을 번갈아 쓴 운영자에게 입고예정이 두 벌로
   * 잡힌다 — 그 사고가 이미 한 번 났다.
   */
  async updatePurchaseOrderStatus(
    poId: string,
    updateDto: UpdatePurchaseOrderStatusDto,
    userId: string,
    tx?: DbTx,
  ): Promise<PurchaseOrderResponse> {
    return this.dbService.run(async (trx) => {
      const [existingPO] = await trx
        .select()
        .from(wmsTables.purchaseOrders)
        .where(eq(wmsTables.purchaseOrders.id, poId))
        .limit(1);

      if (!existingPO) {
        throw new NotFoundException(`Purchase order with ID ${poId} not found`);
      }

      // UPDATE 이후 유효한 도착예정일 — 이 요청이 expectedArrival 도 함께 보내면
      // 그 값이 진실이다. existingPO 는 UPDATE 전 스냅샷이라 그대로 쓰면 방금 쓴 값을
      // 무시하고 계획에 옛 날짜를 심는다(삭제된 createInboundPlanFromPO 는 UPDATE 뒤에
      // 새로 SELECT 했기 때문에 이 문제가 없었다 — 이 포트 전환이 만든 회귀).
      //
      // 정규화는 `new Date(...)` 왕복이 아니라 **앞 10자 절단**이다. updateDto 는
      // 이제 `@Validate(IsCalendarDateConstraint)`(calendar-date.validator.ts) 라
      // HTTP 로 들어오는 값은 이미 정확히 'YYYY-MM-DD' 만 통과한다 — 이 절단은 그
      // 경로를 위한 게 아니라, 서비스를 DTO 검증(ValidationPipe) 없이 직접 부르는
      // 호출자(통합 스펙 등)가 '2026-08-26T00:00:00+09:00' 같은 오프셋 문자열을
      // 넘길 때를 막는 방어선이다("오프셋이 붙은 확정 날짜도 달력 하루가 밀리지
      // 않는다" 스펙이 그 경로를 그대로 재현한다). Date 로 왕복시키면 toISOString 이
      // UTC 로 옮겨 '2026-08-25' 가 된다 — 운영자가 고른 달력 날짜가 하루 밀린다.
      // ISO 8601 은 어떤 형태든 앞 10자가 그 달력 날짜라는 성질만 쓴다.
      const headerExpectedDate: string | null = updateDto.expectedArrival
        ? updateDto.expectedArrival.slice(0, 10)
        : (existingPO.expectedArrival?.toISOString().slice(0, 10) ?? null);

      await trx
        .update(wmsTables.purchaseOrders)
        .set({
          status: updateDto.status,
          // 헤더 컬럼에도 정규화한 날짜(UTC 자정)를 쓴다. 오프셋이 붙은 원본을 그대로
          // 저장하면 헤더만 하루 다른 값을 갖고, 다음 확정의 폴백이 그 드리프트를
          // 계획·라인까지 퍼뜨린다.
          expectedArrival:
            headerExpectedDate && updateDto.expectedArrival
              ? new Date(`${headerExpectedDate}T00:00:00.000Z`)
              : undefined,
          updatedAt: new Date(),
        })
        .where(eq(wmsTables.purchaseOrders.id, poId));

      // 발주가 입고 테이블을 직접 쓰지 않고 InboundService 포트를 통해서만 쓰게 한다
      // (두 번째 writer 제거). ensurePlanForPurchaseOrder 가 해외/국내 판단
      // (source/destination, 창고)을 발주에서 도출하므로 여기서는 넘기지 않는다.
      //
      // 이중 계상 방어는 예전의 `existingPO.status !== 'confirmed'` 가드가 아니라
      // **라인 상태**가 한다. 그 가드는 두 구멍이 있었다: (1) received → confirmed 는
      // 조건을 통과해 이미 처리된 계획에 라인을 한 벌 더 꽂았고, (2) 라인별 실행
      // 화면으로 이미 실행한 라인도 다시 꽂았다. 이제 아직 `requested` 인 라인만
      // 실행하므로 재확정은 자연스러운 no-op 이 된다.
      if (updateDto.status === PurchaseOrderStatus.CONFIRMED) {
        // 라인 status 는 drizzle enum 컬럼(문자열 유니온)이라 리터럴로 비교한다 —
        // TS enum 멤버와 직접 비교하면 no-unsafe-enum-comparison 에 걸린다
        // (auditStatus 비교와 같은 이유).
        const requestedLines = await trx
          .select({
            skuId: wmsTables.purchaseOrderLines.skuId,
            quantity: wmsTables.purchaseOrderLines.quantity,
          })
          .from(wmsTables.purchaseOrderLines)
          .where(
            and(eq(wmsTables.purchaseOrderLines.poId, poId), eq(wmsTables.purchaseOrderLines.status, 'requested')),
          );

        // 실행할 라인이 하나도 없으면 계획도 만들지 않는다 — 아이템 0개짜리 계획 행은
        // 입고 화면에 유령으로 남는다(전 라인 unavailable, 또는 재확정).
        if (requestedLines.length > 0) {
          // 계획을 라인 루프 **앞에서** 헤더 날짜로 한 번 확보한다. 라인 실행의 호출에만
          // 맡기면, 헤더에는 도착예정일이 있고 라인에는 없는 발주가 날짜 NULL 인 계획을
          // 얻는다 — 오늘보다 나빠진다. ensurePlanForPurchaseOrder 는 멱등하므로 뒤이은
          // 라인 실행의 호출은 조회로 끝난다.
          await this.inboundService.ensurePlanForPurchaseOrder(poId, headerExpectedDate, trx);

          // 확정 요청에 새 날짜가 실렸으면 라인·아이템도 그 날짜를 따른다. 넘기는 값은
          // 이미 정규화된 'YYYY-MM-DD' 라 오프셋 위험이 없다 — date 컬럼에 닿으면
          // 안 되는 건 raw `updateDto.expectedArrival` 쪽이다. 새 날짜가 없으면 아무것도
          // 넘기지 않아 라인이 물려받은 값이 그대로 쓰인다(백필된 ETA 보존).
          const bulkArrival = updateDto.expectedArrival ? (headerExpectedDate ?? undefined) : undefined;

          for (const line of requestedLines) {
            await this.executeLineOrder(
              trx,
              poId,
              line.skuId,
              { orderedQty: line.quantity, expectedArrival: bulkArrival },
              userId,
            );
          }
        }
        // 헤더 status 를 다시 계산하지 않는다 — 위 UPDATE 가 이미 confirmed 를 썼고,
        // 남은 requested 라인이 없으니 파생값도 confirmed 로 같다.
      }

      this.logger.log(`Updated purchase order ${poId} status to ${updateDto.status}`);

      return this.getPurchaseOrderById(poId, trx);
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
      return this.getPurchaseOrderById(poId, trx);
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
      return this.getPurchaseOrderById(poId, trx);
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

    const plan = await this.inboundService.ensurePlanForPurchaseOrder(poId, effectiveArrival, tx);
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
    // received 는 입고 경로가 소유한 종결 상태다(스펙 §5 헤더 status 파생표). 여기서
    // 막지 않으면 라인 실행이 계획에 아이템을 더 붙여 inbound_pending_qty 를 부풀리고,
    // refreshHeaderStatus 는 header.status === 'received' 를 보면 일찍 반환하므로
    // 그 뒤로는 아무것도 이 상태를 되돌리지 못한다. drizzle enum 컬럼은 문자열
    // 유니온이라 TS enum 멤버가 아니라 리터럴로 비교한다(no-unsafe-enum-comparison).
    if (po.status === 'received') {
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
   * `received` 는 입고 경로가 소유하므로 여기서 건드리지 않는다.
   */
  private async refreshHeaderStatus(tx: DbTx, poId: string): Promise<void> {
    const [header] = await tx
      .select({ status: wmsTables.purchaseOrders.status })
      .from(wmsTables.purchaseOrders)
      .where(eq(wmsTables.purchaseOrders.id, poId))
      .limit(1);
    if (!header || header.status === 'received') return;

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
      // 필요로 하는 것과 사실상 같아졌다. 그래도 갈아타지 않는 이유는 메시지·예외 타입이
      // 다르기 때문이다 — 그 helper 는 도메인 BadRequestError("Cannot execute purchase
      // order lines with status: ...")를 던지는데, 이 메서드는 라인 수정 엔드포인트에
      // 맞는 Nest BadRequestException("Cannot modify purchase order lines after fully
      // received")을 그대로 유지해야 한다. 합치는 건 API 응답 메시지를 바꾸는 일이라 이
      // 태스크 범위 밖이다.
      const [po] = await trx
        .select()
        .from(wmsTables.purchaseOrders)
        .where(eq(wmsTables.purchaseOrders.id, poId))
        .limit(1)
        .for('update');

      if (!po) {
        throw new NotFoundException(`Purchase order ${poId} not found`);
      }

      // 2. received 상태는 수정 불가
      if (po.status === 'received') {
        throw new BadRequestException('Cannot modify purchase order lines after fully received');
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

      return this.getPurchaseOrderById(poId, trx);
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
      throw new BadRequestException(`Supplier with ID ${supplierId} not found`);
    }
    if (!supplier.defaultWarehouseId) {
      // MD 가 발주 화면에서 직접 읽는 문구다. 원시 UUID 와 영어로는 어디를 고쳐야
      // 하는지 알 수 없다 — 라이브 공급사 전원이 이 값이 비어 있어 사실상 발주의
      // 첫 관문이므로, 다음 행동을 문장에 담는다.
      throw new BadRequestException(
        '이 공급처에 입고 창고가 지정되지 않아 발주를 만들 수 없습니다. 공급처 관리에서 입고 창고를 먼저 지정하세요.',
      );
    }
    return supplier.defaultWarehouseId;
  }

  /**
   * 발주 조회
   */
  async getPurchaseOrderById(poId: string, tx?: DbTx): Promise<PurchaseOrderResponse> {
    return this.dbService.run(async (trx: DbTx) => {
      const [po] = await trx
        .select()
        .from(wmsTables.purchaseOrders)
        .where(eq(wmsTables.purchaseOrders.id, poId))
        .limit(1);

      if (!po) {
        throw new NotFoundException(`Purchase order with ID ${poId} not found`);
      }

      const lines = await trx
        .select({
          skuId: wmsTables.purchaseOrderLines.skuId,
          quantity: wmsTables.purchaseOrderLines.quantity,
          unitPrice: wmsTables.purchaseOrderLines.unitPrice,
          status: wmsTables.purchaseOrderLines.status,
          orderedQty: wmsTables.purchaseOrderLines.orderedQty,
          expectedArrival: wmsTables.purchaseOrderLines.expectedArrival,
          orderedAt: wmsTables.purchaseOrderLines.orderedAt,
          orderedBy: wmsTables.purchaseOrderLines.orderedBy,
          unavailableReason: wmsTables.purchaseOrderLines.unavailableReason,
          skuName: wmsTables.skus.name,
          skuBarcode: sql<string>`(
                      SELECT barcode FROM sku_barcodes
                      WHERE sku_id = ${wmsTables.skus.id} AND is_primary = true
                      LIMIT 1
                    )`,
        })
        .from(wmsTables.purchaseOrderLines)
        .leftJoin(wmsTables.skus, eq(wmsTables.purchaseOrderLines.skuId, wmsTables.skus.id))
        .where(eq(wmsTables.purchaseOrderLines.poId, poId));

      const supplier = po.supplierId
        ? (() =>
            trx
              .select()
              .from(wmsTables.suppliers)
              .where(eq(wmsTables.suppliers.id, po.supplierId))
              .limit(1)
              .then((rows) => rows[0]))()
        : undefined;

      const supplierRow = await supplier;

      return {
        id: po.id,
        type: po.type as PurchaseOrderType,
        supplierId: po.supplierId,
        expectedArrival: po.expectedArrival,
        status: po.status as PurchaseOrderStatus,
        auditStatus: po.auditStatus,
        createdAt: po.createdAt,
        updatedAt: po.updatedAt,
        lines: lines.map((line) => ({
          skuId: line.skuId,
          quantity: line.quantity,
          status: line.status,
          orderedQty: line.orderedQty,
          unitPrice: line.unitPrice,
          expectedArrival: line.expectedArrival,
          orderedAt: line.orderedAt,
          orderedBy: line.orderedBy,
          unavailableReason: line.unavailableReason,
          sku: {
            name: line.skuName ?? '삭제된 상품',
            barcode: line.skuBarcode ?? '',
          },
        })),
        supplier: supplierRow ? SupplierResponseDto.fromDbRow(supplierRow) : undefined,
      };
    }, tx);
  }

  /**
   * 발주 목록 조회
   */
  async getPurchaseOrders(
    status?: PurchaseOrderStatus,
    type?: PurchaseOrderType,
    limit = 50,
    offset = 0,
    tx?: DbTx,
  ): Promise<PurchaseOrderResponse[]> {
    const conditions: SQL[] = [];

    if (status) {
      conditions.push(eq(wmsTables.purchaseOrders.status, status));
    }

    if (type) {
      conditions.push(eq(wmsTables.purchaseOrders.type, type));
    }

    const purchaseOrders = await this.dbService.run(
      async (trx) =>
        trx
          .select()
          .from(wmsTables.purchaseOrders)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(wmsTables.purchaseOrders.createdAt))
          .limit(limit)
          .offset(offset),
      tx,
    );
    const results = [] as PurchaseOrderResponse[];
    for (const po of purchaseOrders) {
      const lines = await this.dbService.run(
        async (trx) =>
          trx
            .select({
              skuId: wmsTables.purchaseOrderLines.skuId,
              quantity: wmsTables.purchaseOrderLines.quantity,
              unitPrice: wmsTables.purchaseOrderLines.unitPrice,
              status: wmsTables.purchaseOrderLines.status,
              orderedQty: wmsTables.purchaseOrderLines.orderedQty,
              expectedArrival: wmsTables.purchaseOrderLines.expectedArrival,
              orderedAt: wmsTables.purchaseOrderLines.orderedAt,
              orderedBy: wmsTables.purchaseOrderLines.orderedBy,
              unavailableReason: wmsTables.purchaseOrderLines.unavailableReason,
              skuName: wmsTables.skus.name,
              skuBarcode: sql<string>`(
                      SELECT barcode FROM sku_barcodes
                      WHERE sku_id = ${wmsTables.skus.id} AND is_primary = true
                      LIMIT 1
                    )`,
            })
            .from(wmsTables.purchaseOrderLines)
            .leftJoin(wmsTables.skus, eq(wmsTables.purchaseOrderLines.skuId, wmsTables.skus.id))
            .where(eq(wmsTables.purchaseOrderLines.poId, po.id)),
        tx,
      );

      const supplier = po.supplierId
        ? await this.dbService.run(async (trx) => {
            const [row] = await trx
              .select()
              .from(wmsTables.suppliers)
              .where(eq(wmsTables.suppliers.id, po.supplierId!))
              .limit(1);
            return row;
          }, tx)
        : undefined;

      results.push({
        id: po.id,
        type: po.type as PurchaseOrderType,
        supplierId: po.supplierId,
        expectedArrival: po.expectedArrival,
        status: po.status as PurchaseOrderStatus,
        auditStatus: po.auditStatus,
        createdAt: po.createdAt,
        updatedAt: po.updatedAt,
        lines: lines.map((line) => ({
          skuId: line.skuId,
          quantity: line.quantity,
          status: line.status,
          orderedQty: line.orderedQty,
          unitPrice: line.unitPrice,
          expectedArrival: line.expectedArrival,
          orderedAt: line.orderedAt,
          orderedBy: line.orderedBy,
          unavailableReason: line.unavailableReason,
          sku: {
            name: line.skuName ?? '',
            barcode: line.skuBarcode ?? '',
          },
        })),
        supplier: supplier ? SupplierResponseDto.fromDbRow(supplier) : undefined,
      });
    }
    return results;
  }

  // ========== 발주대기리스트 (Cart) 관리 ==========

  /**
   * 장바구니에 아이템 추가
   */
  async addToCart(addDto: AddToCartDto, userId: string, tx?: DbTx): Promise<CartItemResponse> {
    const existingItem = await this.dbService.run(async (trx) => {
      const [row] = await trx
        .select()
        .from(wmsTables.purchaseOrderCart)
        .where(
          and(
            eq(wmsTables.purchaseOrderCart.skuId, addDto.skuId),
            eq(wmsTables.purchaseOrderCart.type, addDto.type),
            eq(wmsTables.purchaseOrderCart.createdBy, userId),
          ),
        )
        .limit(1);
      return row;
    }, tx);

    if (existingItem) {
      await this.dbService.run(
        async (trx) =>
          trx
            .update(wmsTables.purchaseOrderCart)
            .set({
              quantity: existingItem.quantity + addDto.quantity,
              supplierId: addDto.supplierId || existingItem.supplierId,
              updatedAt: new Date(),
            })
            .where(eq(wmsTables.purchaseOrderCart.id, existingItem.id)),
        tx,
      );
      return this.getCartItemById(existingItem.id, userId, tx);
    } else {
      const [cartItem] = await this.dbService.run(
        async (trx) =>
          trx
            .insert(wmsTables.purchaseOrderCart)
            .values({
              skuId: addDto.skuId,
              quantity: addDto.quantity,
              type: addDto.type,
              supplierId: addDto.supplierId,
              createdBy: userId,
            })
            .returning(),
        tx,
      );

      return this.getCartItemById(cartItem.id, userId, tx);
    }
  }

  /**
   * 장바구니 아이템 수정
   */
  async updateCartItem(
    itemId: string,
    userId: string,
    updateDto: UpdateCartItemDto,
    tx?: DbTx,
  ): Promise<CartItemResponse> {
    const existingItem = await this.dbService.run(async (trx) => {
      const [row] = await trx
        .select()
        .from(wmsTables.purchaseOrderCart)
        .where(and(eq(wmsTables.purchaseOrderCart.id, itemId), eq(wmsTables.purchaseOrderCart.createdBy, userId)))
        .limit(1);
      return row;
    }, tx);

    if (!existingItem) {
      throw new NotFoundException(`Cart item with ID ${itemId} not found or you don't have permission to modify it`);
    }

    await this.dbService.run(
      async (trx) =>
        trx
          .update(wmsTables.purchaseOrderCart)
          .set({
            quantity: updateDto.quantity,
            supplierId: updateDto.supplierId ?? existingItem.supplierId,
            updatedAt: new Date(),
          })
          .where(eq(wmsTables.purchaseOrderCart.id, itemId)),
      tx,
    );
    return this.getCartItemById(itemId, userId, tx);
  }

  /**
   * 장바구니에서 아이템 제거
   */
  async removeFromCart(itemId: string, userId: string, tx?: DbTx): Promise<void> {
    const result = await this.dbService.run(
      async (trx) =>
        trx
          .delete(wmsTables.purchaseOrderCart)
          .where(and(eq(wmsTables.purchaseOrderCart.id, itemId), eq(wmsTables.purchaseOrderCart.createdBy, userId)))
          .returning(),
      tx,
    );

    if (result.length === 0) {
      throw new NotFoundException(`Cart item with ID ${itemId} not found or you don't have permission to delete it`);
    }

    this.logger.log(`Removed cart item ${itemId}`);
  }

  /**
   * 장바구니 조회
   */
  async getCartItems(type: PurchaseOrderType | undefined, userId: string, tx?: DbTx): Promise<CartItemResponse[]> {
    const conditions: SQL[] = [eq(wmsTables.purchaseOrderCart.createdBy, userId)];
    if (type) {
      conditions.push(eq(wmsTables.purchaseOrderCart.type, type));
    }

    const cartItems = await this.dbService.run(
      async (trx) =>
        trx
          .select({
            id: wmsTables.purchaseOrderCart.id,
            skuId: wmsTables.purchaseOrderCart.skuId,
            quantity: wmsTables.purchaseOrderCart.quantity,
            type: wmsTables.purchaseOrderCart.type,
            supplierId: wmsTables.purchaseOrderCart.supplierId,
            supplierName: wmsTables.suppliers.name,
            createdAt: wmsTables.purchaseOrderCart.createdAt,
            updatedAt: wmsTables.purchaseOrderCart.updatedAt,
            skuName: wmsTables.skus.name,
            skuBarcode: sql<string>`(
                  SELECT barcode FROM sku_barcodes 
                  WHERE sku_id = ${wmsTables.skus.id} AND is_primary = true 
                  LIMIT 1
                )`,
          })
          .from(wmsTables.purchaseOrderCart)
          .leftJoin(wmsTables.skus, eq(wmsTables.purchaseOrderCart.skuId, wmsTables.skus.id))
          .leftJoin(wmsTables.suppliers, eq(wmsTables.purchaseOrderCart.supplierId, wmsTables.suppliers.id))
          .where(and(...conditions))
          .orderBy(desc(wmsTables.purchaseOrderCart.createdAt)),
      tx,
    );

    return cartItems.map((item) => ({
      id: item.id,
      skuId: item.skuId,
      quantity: item.quantity,
      type: item.type as PurchaseOrderType,
      supplier:
        item.supplierId && item.supplierName
          ? {
              id: item.supplierId,
              name: item.supplierName,
            }
          : null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      sku: {
        name: item.skuName ?? '',
        barcode: item.skuBarcode ?? '',
      },
    }));
  }

  /**
   * 장바구니 아이템 조회
   */
  private async getCartItemById(itemId: string, userId: string, tx?: DbTx): Promise<CartItemResponse> {
    const item = await this.dbService.run(async (trx) => {
      const [row] = await trx
        .select({
          id: wmsTables.purchaseOrderCart.id,
          skuId: wmsTables.purchaseOrderCart.skuId,
          quantity: wmsTables.purchaseOrderCart.quantity,
          type: wmsTables.purchaseOrderCart.type,
          supplierId: wmsTables.purchaseOrderCart.supplierId,
          supplierName: wmsTables.suppliers.name,
          createdAt: wmsTables.purchaseOrderCart.createdAt,
          updatedAt: wmsTables.purchaseOrderCart.updatedAt,
          skuName: wmsTables.skus.name,
          skuBarcode: sql<string>`(
                      SELECT barcode FROM sku_barcodes 
                      WHERE sku_id = ${wmsTables.skus.id} AND is_primary = true 
                      LIMIT 1
                    )`,
        })
        .from(wmsTables.purchaseOrderCart)
        .leftJoin(wmsTables.skus, eq(wmsTables.purchaseOrderCart.skuId, wmsTables.skus.id))
        .leftJoin(wmsTables.suppliers, eq(wmsTables.purchaseOrderCart.supplierId, wmsTables.suppliers.id))
        .where(and(eq(wmsTables.purchaseOrderCart.id, itemId), eq(wmsTables.purchaseOrderCart.createdBy, userId)))
        .limit(1);
      return row;
    }, tx);

    if (!item) {
      throw new NotFoundException(`Cart item with ID ${itemId} not found`);
    }

    return {
      id: item.id,
      skuId: item.skuId,
      quantity: item.quantity,
      type: item.type as PurchaseOrderType,
      supplier:
        item.supplierId && item.supplierName
          ? {
              id: item.supplierId,
              name: item.supplierName,
            }
          : null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      sku: {
        name: item.skuName ?? '',
        barcode: item.skuBarcode ?? '',
      },
    };
  }

  /**
   * 장바구니 비우기
   */
  async clearCart(type: PurchaseOrderType | undefined, userId: string, tx?: DbTx): Promise<void> {
    const conditions: SQL[] = [eq(wmsTables.purchaseOrderCart.createdBy, userId)];
    if (type) {
      conditions.push(eq(wmsTables.purchaseOrderCart.type, type));
    }

    await this.dbService.run(async (trx) => trx.delete(wmsTables.purchaseOrderCart).where(and(...conditions)), tx);

    this.logger.log(`Cleared cart${type ? ` for type ${type}` : ''} for user ${userId}`);
  }

  // ========== 재주문 제안 ==========

  /**
   * 재주문 제안 조회
   * 안전재고 미만으로 떨어진 상품 목록
   */
  async getReorderSuggestions(warehouseId?: string, tx?: DbTx): Promise<StockReorderSuggestion[]> {
    // stockSummary view에서 안전재고 미만 상품 조회
    // 현재는 단순히 availableQty < 10인 상품을 반환 (향후 안전재고 설정 기능 추가 시 개선)

    const query = sql`
            SELECT
                s.id as sku_id,
                s.name as sku_name,
                COALESCE(ss.available_qty, 0) as current_stock,
                10 as safety_stock,  -- 임시 값
                (10 - COALESCE(ss.available_qty, 0)) as shortfall,
                GREATEST(20 - COALESCE(ss.available_qty, 0), 0) as suggested_order,
                COALESCE(ss.on_order_qty, 0) as on_order_qty,
                COALESCE(ss.in_transfer_qty, 0) as in_transfer_qty
            FROM skus s
            LEFT JOIN stock_summary_view ss ON s.id = ss.sku_id
            WHERE COALESCE(ss.available_qty, 0) < 10
            ${warehouseId ? sql`AND ss.warehouse_id = ${warehouseId}` : sql``}
            ORDER BY shortfall DESC
            LIMIT 100
        `;

    interface ReorderSuggestionRow {
      sku_id: string;
      sku_name: string;
      current_stock: number;
      safety_stock: number;
      shortfall: number;
      suggested_order: number;
      on_order_qty: number;
      in_transfer_qty: number;
    }

    const results = await this.dbService.run(async (trx) => trx.execute(query), tx);
    const rows = results as unknown as ReorderSuggestionRow[];

    return rows.map((row) => ({
      skuId: row.sku_id,
      skuName: row.sku_name,
      currentStock: row.current_stock,
      safetyStock: row.safety_stock,
      shortfall: row.shortfall,
      suggestedOrder: row.suggested_order,
      onOrderQty: row.on_order_qty,
      inTransferQty: row.in_transfer_qty,
    }));
  }
}
