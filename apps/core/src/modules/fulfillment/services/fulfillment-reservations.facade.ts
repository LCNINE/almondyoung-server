import { Injectable, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import { eq, and, asc, gt, ne, inArray } from 'drizzle-orm';
import { UnifiedReservationService } from '../../inventory/shared/services/unified-reservation.service';
import { ProductSellableQuantityService } from '../../inventory/product-sellable-quantity/services/product-sellable-quantity.service';
import { PoliciesService } from './policies.service';

@Injectable()
export class FulfillmentReservationsFacade {
  private readonly logger = new Logger(FulfillmentReservationsFacade.name);

  constructor(
    private readonly db: DbService<typeof wmsSchema>,
    private readonly unified: UnifiedReservationService,
    private readonly productSellableQuantity: ProductSellableQuantityService,
    private readonly policies: PoliciesService,
  ) {}

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.db.transaction(fn);
  }

  private readonly TERMINAL_STATUSES = ['shipped', 'completed', 'canceled'] as const;

  private readonly RESERVATION_TRANSFER_ALLOWED_STATUS_LIST = [
    'created',
    'reserving',
    'ready',
    'unfulfillable',
  ] as const;

  private readonly RESERVATION_TRANSFER_ALLOWED_STATUSES = new Set<string>(
    this.RESERVATION_TRANSFER_ALLOWED_STATUS_LIST,
  );

  async reserve(
    urlFulfillmentOrderId: string,
    dto: { fulfillmentOrderItemId: string; quantity: number },
    tx?: DbTx,
  ) {
    return this.inTx(async (trx) => {
      if (dto.quantity <= 0) {
        throw new BadRequestException('Reserve quantity must be greater than 0');
      }

      // 잠금 순서 컨벤션: FO(id asc) → FOI(id asc). FO id 발견용 사전 조회는 잠금 없이.
      const [preFoi] = await trx
        .select({
          id: wmsTables.fulfillmentOrderItems.id,
          fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId,
        })
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, dto.fulfillmentOrderItemId));
      if (!preFoi) {
        throw new BadRequestException(`FOI ${dto.fulfillmentOrderItemId} not found`);
      }
      if (preFoi.fulfillmentOrderId !== urlFulfillmentOrderId) {
        throw new BadRequestException(
          `FOI ${preFoi.id} belongs to FO ${preFoi.fulfillmentOrderId}, not ${urlFulfillmentOrderId}`,
        );
      }

      const [fo] = await trx
        .select()
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, preFoi.fulfillmentOrderId))
        .for('update');
      if (!fo) {
        throw new BadRequestException(`FO ${preFoi.fulfillmentOrderId} not found`);
      }
      if (this.TERMINAL_STATUSES.includes(fo.status as never)) {
        throw new ConflictException(`Cannot reserve for FO ${fo.id} in status '${fo.status}'`);
      }
      if (!fo.warehouseId) {
        throw new BadRequestException(`FO ${fo.id} has no warehouseId`);
      }

      const [foi] = await trx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, dto.fulfillmentOrderItemId))
        .for('update');
      if (!foi) {
        throw new BadRequestException(`FOI ${dto.fulfillmentOrderItemId} not found`);
      }

      // over-reserve 방지 불변식: 재고가 있어도 FOI 부족분(qty - reservedQty)을 초과해 예약할 수 없다
      const foiShortage = foi.qty - (foi.reservedQty || 0);
      if (dto.quantity > foiShortage) {
        throw new BadRequestException(
          `Cannot reserve ${dto.quantity} for FOI ${foi.id}: only ${Math.max(foiShortage, 0)} unreserved (qty=${foi.qty}, reservedQty=${foi.reservedQty || 0})`,
        );
      }

      const reservation = await this.unified.reserveStock(
        {
          targetType: 'FULFILLMENT_ORDER',
          targetId: fo.id,
          skuId: foi.skuId,
          warehouseId: fo.warehouseId,
          quantity: dto.quantity,
          fulfillmentOrderItemId: foi.id,
          reason: 'Fulfillment order item reservation',
        },
        trx,
      );

      await trx
        .update(wmsTables.fulfillmentOrderItems)
        .set({ reservedQty: (foi.reservedQty || 0) + dto.quantity, updatedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrderItems.id, foi.id));

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ totalReservedQty: (fo.totalReservedQty || 0) + dto.quantity, updatedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrders.id, fo.id));

      await this.refreshReservationStatus(fo.id, trx);

      this.logger.log(`Reserved ${dto.quantity} of SKU ${foi.skuId} for FO ${fo.id} (FOI ${foi.id})`);
      return reservation;
    }, tx);
  }

  async unreserve(
    urlFulfillmentOrderId: string,
    dto: { fulfillmentOrderItemId: string; quantity: number },
    tx?: DbTx,
  ) {
    return this.inTx(async (trx) => {
      // 잠금 순서 컨벤션: FO(id asc) → FOI(id asc) → stock_reservations(createdAt, id asc)
      const [preFoi] = await trx
        .select({
          id: wmsTables.fulfillmentOrderItems.id,
          fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId,
        })
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, dto.fulfillmentOrderItemId));
      if (!preFoi) {
        throw new BadRequestException(`FOI ${dto.fulfillmentOrderItemId} not found`);
      }
      if (preFoi.fulfillmentOrderId !== urlFulfillmentOrderId) {
        throw new BadRequestException(
          `FOI ${preFoi.id} belongs to FO ${preFoi.fulfillmentOrderId}, not ${urlFulfillmentOrderId}`,
        );
      }

      const [fo] = await trx
        .select()
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, preFoi.fulfillmentOrderId))
        .for('update');
      if (!fo) {
        throw new BadRequestException(`FO ${preFoi.fulfillmentOrderId} not found`);
      }
      if (this.TERMINAL_STATUSES.includes(fo.status as never)) {
        throw new ConflictException(`Cannot unreserve for FO ${fo.id} in status '${fo.status}'`);
      }

      const [foi] = await trx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, dto.fulfillmentOrderItemId))
        .for('update');
      if (!foi) {
        throw new BadRequestException(`FOI ${dto.fulfillmentOrderItemId} not found`);
      }
      if (foi.shippedQty > 0) {
        throw new ConflictException(
          `Cannot unreserve FOI ${foi.id}: shipped evidence exists (shippedQty=${foi.shippedQty})`,
        );
      }

      // 해당 FOI의 confirmed row만 잠그고 차감 — 같은 FO·SKU의 다른 FOI 예약을 건드리지 않는다
      const reservations = await trx
        .select()
        .from(wmsTables.stockReservations)
        .where(
          and(
            eq(wmsTables.stockReservations.targetType, 'FULFILLMENT_ORDER'),
            eq(wmsTables.stockReservations.targetId, fo.id),
            eq(wmsTables.stockReservations.fulfillmentOrderItemId, foi.id),
            eq(wmsTables.stockReservations.skuId, foi.skuId),
            eq(wmsTables.stockReservations.status, 'confirmed'),
          ),
        )
        .orderBy(asc(wmsTables.stockReservations.createdAt), asc(wmsTables.stockReservations.id))
        .for('update');

      let remaining = dto.quantity;
      for (const r of reservations) {
        if (remaining <= 0) break;
        if (r.quantity <= remaining) {
          await this.unified.releaseReservation(r.id, trx);
          remaining -= r.quantity;
        } else {
          await trx
            .update(wmsTables.stockReservations)
            .set({ quantity: r.quantity - remaining, updatedAt: new Date() })
            .where(and(eq(wmsTables.stockReservations.id, r.id), eq(wmsTables.stockReservations.status, 'confirmed')));
          remaining = 0;
        }
      }

      const released = dto.quantity - Math.max(0, remaining);
      if (released > 0) {
        await this.productSellableQuantity.recalculateAndPublishForSku(foi.skuId, trx);
      }

      await trx
        .update(wmsTables.fulfillmentOrderItems)
        .set({ reservedQty: Math.max(0, (foi.reservedQty || 0) - released), updatedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrderItems.id, foi.id));

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ totalReservedQty: Math.max(0, (fo.totalReservedQty || 0) - released), updatedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrders.id, fo.id));

      await this.refreshReservationStatus(fo.id, trx);

      this.logger.log(`Unreserved ${released}/${dto.quantity} of SKU ${foi.skuId} for FO ${fo.id} (FOI ${foi.id})`);
    }, tx);
  }

  async transferReservation(
    urlFulfillmentOrderId: string,
    dto: {
      fromFulfillmentOrderItemId: string;
      toFulfillmentOrderItemId: string;
      quantity: number;
      /** 감사 추적용 — controller가 인증 사용자 id를 주입한다 (body에서 받지 않음) */
      performedBy?: string;
    },
    tx?: DbTx,
  ) {
    return this.inTx(async (trx) => {
      if (dto.quantity <= 0) {
        throw new BadRequestException('이전 수량은 1 이상이어야 합니다.');
      }
      if (dto.fromFulfillmentOrderItemId === dto.toFulfillmentOrderItemId) {
        throw new BadRequestException('출처와 대상 FOI가 동일합니다. 자기 자신으로는 이전할 수 없습니다.');
      }

      // 잠금 순서 컨벤션 (ready 상태 재고 조정 액션 공통):
      //   FO(id asc) → FOI(id asc) → stock_reservations(createdAt, id asc)
      // FO id를 알기 위한 FOI 사전 조회는 잠금 없이 수행하고,
      // 수량/상태 검증은 전부 잠근 row 기준으로 다시 한다.
      const preItems = await trx
        .select({
          id: wmsTables.fulfillmentOrderItems.id,
          fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId,
        })
        .from(wmsTables.fulfillmentOrderItems)
        .where(
          inArray(wmsTables.fulfillmentOrderItems.id, [dto.fromFulfillmentOrderItemId, dto.toFulfillmentOrderItemId]),
        );

      const preFrom = preItems.find((item) => item.id === dto.fromFulfillmentOrderItemId);
      if (!preFrom) {
        throw new BadRequestException(`출처 FOI ${dto.fromFulfillmentOrderItemId}를 찾을 수 없습니다.`);
      }
      if (preFrom.fulfillmentOrderId !== urlFulfillmentOrderId) {
        throw new BadRequestException(
          `출처 FOI ${preFrom.id}는 FO ${preFrom.fulfillmentOrderId}에 속합니다. (요청: ${urlFulfillmentOrderId})`,
        );
      }
      const preTo = preItems.find((item) => item.id === dto.toFulfillmentOrderItemId);
      if (!preTo) {
        throw new BadRequestException(`대상 FOI ${dto.toFulfillmentOrderItemId}를 찾을 수 없습니다.`);
      }

      // 1) FO 잠금 — 상태 검증 통과 직후 allocation/picking이 status를 바꾸는 경합 차단
      const lockedFos = await trx
        .select()
        .from(wmsTables.fulfillmentOrders)
        .where(inArray(wmsTables.fulfillmentOrders.id, [preFrom.fulfillmentOrderId, preTo.fulfillmentOrderId]))
        .orderBy(asc(wmsTables.fulfillmentOrders.id))
        .for('update');

      const fromFo = lockedFos.find((fo) => fo.id === preFrom.fulfillmentOrderId);
      if (!fromFo) {
        throw new BadRequestException(`출처 FO ${preFrom.fulfillmentOrderId}를 찾을 수 없습니다.`);
      }

      const toFo = lockedFos.find((fo) => fo.id === preTo.fulfillmentOrderId);
      if (!toFo) {
        throw new BadRequestException(`대상 FO ${preTo.fulfillmentOrderId}를 찾을 수 없습니다.`);
      }

      // 2) FOI 잠금 — 동시 이전 시 reservedQty lost update 방지, 수량 검증은 잠근 값 기준
      const lockedItems = await trx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(
          inArray(wmsTables.fulfillmentOrderItems.id, [dto.fromFulfillmentOrderItemId, dto.toFulfillmentOrderItemId]),
        )
        .orderBy(asc(wmsTables.fulfillmentOrderItems.id))
        .for('update');

      const from = lockedItems.find((item) => item.id === dto.fromFulfillmentOrderItemId);
      if (!from) {
        throw new BadRequestException(`출처 FOI ${dto.fromFulfillmentOrderItemId}를 찾을 수 없습니다.`);
      }
      const to = lockedItems.find((item) => item.id === dto.toFulfillmentOrderItemId);
      if (!to) {
        throw new BadRequestException(`대상 FOI ${dto.toFulfillmentOrderItemId}를 찾을 수 없습니다.`);
      }

      if (from.skuId !== to.skuId) {
        throw new BadRequestException('출처와 대상 FOI의 SKU가 다릅니다.');
      }

      if (!fromFo.warehouseId || !toFo.warehouseId) {
        throw new BadRequestException('FO에 창고가 지정되어 있지 않습니다.');
      }
      if (fromFo.warehouseId !== toFo.warehouseId) {
        throw new BadRequestException('서로 다른 창고 간 예약 이전은 허용되지 않습니다.');
      }

      if (!this.RESERVATION_TRANSFER_ALLOWED_STATUSES.has(fromFo.status)) {
        throw new ConflictException(
          `출처 FO(${fromFo.id})의 상태(${fromFo.status})에서는 예약 이전이 허용되지 않습니다. 피킹이 시작된 출고주문은 예약을 이전할 수 없습니다.`,
        );
      }
      if (!this.RESERVATION_TRANSFER_ALLOWED_STATUSES.has(toFo.status)) {
        throw new ConflictException(
          `대상 FO(${toFo.id})의 상태(${toFo.status})에서는 예약 이전이 허용되지 않습니다. 피킹이 시작된 출고주문은 예약을 이전할 수 없습니다.`,
        );
      }

      if ((from.reservedQty ?? 0) < dto.quantity) {
        throw new BadRequestException(
          `출처 FOI의 예약 수량(${from.reservedQty ?? 0})이 이전 수량(${dto.quantity})보다 부족합니다.`,
        );
      }

      const toShortage = to.qty - (to.reservedQty ?? 0);
      if (toShortage <= 0) {
        throw new BadRequestException('대상 FOI는 추가 예약이 필요하지 않습니다 (부족분이 0입니다).');
      }
      if (dto.quantity > toShortage) {
        throw new BadRequestException(
          `이전 수량(${dto.quantity})이 대상 FOI의 미예약 부족분(${toShortage})을 초과합니다.`,
        );
      }

      // 기존 confirmed reservation row를 직접 차감/해제 (가용재고 재확인 없이)
      // createdAt ASC: 오래된 row부터 소진 — 동일 row 처리 순서를 일관되게 유지해 데드락 방지
      const fromReservations = await trx
        .select()
        .from(wmsTables.stockReservations)
        .where(
          and(
            eq(wmsTables.stockReservations.targetType, 'FULFILLMENT_ORDER'),
            eq(wmsTables.stockReservations.targetId, fromFo.id),
            eq(wmsTables.stockReservations.fulfillmentOrderItemId, from.id),
            eq(wmsTables.stockReservations.skuId, from.skuId),
            eq(wmsTables.stockReservations.status, 'confirmed'),
          ),
        )
        .orderBy(asc(wmsTables.stockReservations.createdAt), asc(wmsTables.stockReservations.id))
        .for('update');

      let remaining = dto.quantity;
      for (const r of fromReservations) {
        if (remaining <= 0) break;
        if (r.quantity <= remaining) {
          await trx
            .update(wmsTables.stockReservations)
            .set({ status: 'released', updatedAt: new Date() })
            .where(eq(wmsTables.stockReservations.id, r.id));
          remaining -= r.quantity;
        } else {
          await trx
            .update(wmsTables.stockReservations)
            .set({ quantity: r.quantity - remaining, updatedAt: new Date() })
            .where(eq(wmsTables.stockReservations.id, r.id));
          remaining = 0;
        }
      }

      if (remaining > 0) {
        throw new ConflictException(
          `출처 FOI의 확정 예약 row에서 ${dto.quantity}개를 차감할 수 없습니다 (부족: ${remaining}).`,
        );
      }

      // 대상 FOI에 새 confirmed reservation row 생성
      await trx.insert(wmsTables.stockReservations).values({
        targetType: 'FULFILLMENT_ORDER',
        targetId: toFo.id,
        skuId: to.skuId,
        warehouseId: toFo.warehouseId,
        quantity: dto.quantity,
        fulfillmentOrderItemId: to.id,
        status: 'confirmed',
        reason: `예약 이전: FOI ${from.id} → FOI ${to.id}${dto.performedBy ? ` (by ${dto.performedBy})` : ''}`,
      });

      // FOI reservedQty 업데이트 — from/to는 FOR UPDATE로 잠근 최신 값
      await trx
        .update(wmsTables.fulfillmentOrderItems)
        .set({ reservedQty: (from.reservedQty ?? 0) - dto.quantity, updatedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrderItems.id, from.id));

      await trx
        .update(wmsTables.fulfillmentOrderItems)
        .set({ reservedQty: (to.reservedQty ?? 0) + dto.quantity, updatedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrderItems.id, to.id));

      // FO totalReservedQty는 refreshReservationStatus가 item 합계로 재계산하므로 별도 ± 갱신 없음
      // (SKU 전체 confirmed 합계는 변하지 않으므로 sellable 재계산도 불필요)
      await this.refreshReservationStatus(fromFo.id, trx);
      if (fromFo.id !== toFo.id) {
        await this.refreshReservationStatus(toFo.id, trx);
      }

      this.logger.log(
        `예약 이전 완료: ${dto.quantity}개 FOI ${from.id} (FO ${fromFo.id}) → FOI ${to.id} (FO ${toFo.id})${
          dto.performedBy ? ` by ${dto.performedBy}` : ''
        }`,
      );
    }, tx);
  }

  /**
   * 예약 이전 대상 후보 조회.
   * 같은 창고 · 같은 SKU · 작업 전 상태(created/reserving/ready/unfulfillable) FO의 FOI 중
   * 미예약 부족분(qty - reservedQty)이 있는 것만 반환한다. cross-FO 후보 포함.
   */
  async getTransferCandidates(urlFulfillmentOrderId: string, fromFulfillmentOrderItemId: string, tx?: DbTx) {
    const db = tx ?? this.db.db;

    const [from] = await db
      .select()
      .from(wmsTables.fulfillmentOrderItems)
      .where(eq(wmsTables.fulfillmentOrderItems.id, fromFulfillmentOrderItemId));
    if (!from) {
      throw new BadRequestException(`출처 FOI ${fromFulfillmentOrderItemId}를 찾을 수 없습니다.`);
    }
    if (from.fulfillmentOrderId !== urlFulfillmentOrderId) {
      throw new BadRequestException(
        `출처 FOI ${from.id}는 FO ${from.fulfillmentOrderId}에 속합니다. (요청: ${urlFulfillmentOrderId})`,
      );
    }

    const [fromFo] = await db
      .select()
      .from(wmsTables.fulfillmentOrders)
      .where(eq(wmsTables.fulfillmentOrders.id, from.fulfillmentOrderId));
    if (!fromFo?.warehouseId) {
      return [];
    }

    // source-side 정책도 transfer와 동일하게 적용 — 이전 불가능한 출처라면 후보를 보여주지 않는다
    if (!this.RESERVATION_TRANSFER_ALLOWED_STATUSES.has(fromFo.status)) {
      return [];
    }
    if ((from.reservedQty ?? 0) <= 0) {
      return [];
    }

    const rows = await db
      .select({
        id: wmsTables.fulfillmentOrderItems.id,
        fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId,
        fulfillmentOrderStatus: wmsTables.fulfillmentOrders.status,
        salesOrderId: wmsTables.fulfillmentOrders.salesOrderId,
        skuId: wmsTables.fulfillmentOrderItems.skuId,
        qty: wmsTables.fulfillmentOrderItems.qty,
        reservedQty: wmsTables.fulfillmentOrderItems.reservedQty,
      })
      .from(wmsTables.fulfillmentOrderItems)
      .innerJoin(
        wmsTables.fulfillmentOrders,
        eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, wmsTables.fulfillmentOrders.id),
      )
      .where(
        and(
          ne(wmsTables.fulfillmentOrderItems.id, from.id),
          eq(wmsTables.fulfillmentOrderItems.skuId, from.skuId),
          eq(wmsTables.fulfillmentOrders.warehouseId, fromFo.warehouseId),
          inArray(wmsTables.fulfillmentOrders.status, [...this.RESERVATION_TRANSFER_ALLOWED_STATUS_LIST]),
          gt(wmsTables.fulfillmentOrderItems.qty, wmsTables.fulfillmentOrderItems.reservedQty),
        ),
      )
      .orderBy(asc(wmsTables.fulfillmentOrders.createdAt), asc(wmsTables.fulfillmentOrderItems.id))
      .limit(50);

    return rows.map((row) => ({
      ...row,
      shortage: row.qty - (row.reservedQty ?? 0),
      sameFulfillmentOrder: row.fulfillmentOrderId === urlFulfillmentOrderId,
    }));
  }

  private async refreshReservationStatus(fulfillmentOrderId: string, trx: DbTx): Promise<void> {
    const fo = await trx.query.fulfillmentOrders.findFirst({
      where: eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId),
    });
    if (!fo) return;

    if (
      [
        'labeled',
        'allocated',
        'picking',
        'picked',
        'inspecting',
        'invoiced',
        'completed',
        'forwarded',
        'shipped',
        'canceled',
      ].includes(fo.status)
    ) {
      return;
    }

    const items = await trx.query.fulfillmentOrderItems.findMany({
      where: eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fulfillmentOrderId),
    });
    if (items.length === 0) return;

    const totalReservedQty = items.reduce((sum, item) => sum + (item.reservedQty || 0), 0);
    const reservationRequirements = await Promise.all(
      items.map((item) => this.requiresStockReservation(item.variantId, trx)),
    );
    const allReserved = items.every(
      (item, index) => !reservationRequirements[index] || (item.reservedQty || 0) >= item.qty,
    );

    await trx
      .update(wmsTables.fulfillmentOrders)
      .set({
        status: allReserved ? 'ready' : ['ready', 'pending'].includes(fo.status) ? 'created' : fo.status,
        totalReservedQty,
        reservationFailureReason: allReserved ? null : fo.reservationFailureReason,
        reservationFailureDetails: allReserved ? null : fo.reservationFailureDetails,
        updatedAt: new Date(),
      })
      .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));

    // FulfillmentReady 는 구독하는 서비스가 없어 발행하지 않는다 (설계 원칙: 미구독 이벤트 미발행).
    // allReserved 시 FO 상태는 위에서 이미 'ready' 로 갱신되며, 어드민/스토어프론트는 Core API 로 직접 조회한다.
  }

  private async requiresStockReservation(variantId: string | null | undefined, trx: DbTx): Promise<boolean> {
    if (!variantId) return true;

    const policy = await this.policies.getVariantPolicy(variantId, trx);
    return policy.inventoryManagement;
  }
}
