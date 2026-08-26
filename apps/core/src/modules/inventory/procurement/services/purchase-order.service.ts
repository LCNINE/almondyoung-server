import { Injectable } from '@nestjs/common';
import { DbTx } from '../../schema/inventory.schema';
import {
  CreatePurchaseOrderDto,
  UpdatePurchaseOrderStatusDto,
  UpdatePurchaseOrderLinesDto,
  CreatePurchaseOrderFromCartDto,
  PurchaseOrderResponse,
  PurchaseOrderStatus,
  PurchaseOrderType,
} from '../dto/purchase-order.dto';
import { OrderPurchaseOrderLineDto, MarkLineUnavailableDto } from '../dto/purchase-order/execute-line.dto';
import { PurchaseOrderManager } from './purchase-order.manager';
import { PurchaseOrderReader } from './purchase-order.reader';

/**
 * 발주 포트. **위임만 한다** — 검증·비즈니스 로직·쓰기는 `PurchaseOrderManager`,
 * 조회는 `PurchaseOrderReader` 가 소유한다. 선례는 `warehouse-transfer.service.ts`.
 *
 * 🔴 **잠금 순서 불변식: PO 행 → 라인 행.** 이 파일에는 지금 쓰기가 없지만, 여기에 DB 접근을
 * 추가하는 편집은 그 순간 이 규약의 적용 대상이 된다 — 그럴 거면 Manager 로 갈 것.
 * 순서가 뒤집히면 ABBA 교착이 40P01 → 500 으로 나간다.
 *
 * 경계는 ADR-0032 가 소유한다 — 발주는 출발 창고 입고까지만 소유하고 거기서 종결하며,
 * 선적은 `transfer_orders` 가 독립 소유하고 발주와 링크하지 않는다.
 *
 * 카트(`PurchaseOrderCartService`)와 재주문 제안(`ReorderSuggestionReader`)은 컨트롤러가
 * 직접 주입받는다 — 이 포트를 거치지 않는다.
 */
@Injectable()
export class PurchaseOrderService {
  constructor(
    private readonly manager: PurchaseOrderManager,
    private readonly reader: PurchaseOrderReader,
  ) {}

  // ========== 쓰기 (Manager 소유) ==========

  createPurchaseOrder(createDto: CreatePurchaseOrderDto, tx?: DbTx): Promise<PurchaseOrderResponse> {
    return this.manager.createPurchaseOrder(createDto, tx);
  }

  createPurchaseOrderFromCart(
    createDto: CreatePurchaseOrderFromCartDto,
    userId: string,
    tx?: DbTx,
  ): Promise<PurchaseOrderResponse> {
    return this.manager.createPurchaseOrderFromCart(createDto, userId, tx);
  }

  updatePurchaseOrderStatus(
    poId: string,
    updateDto: UpdatePurchaseOrderStatusDto,
    userId: string,
    tx?: DbTx,
  ): Promise<PurchaseOrderResponse> {
    return this.manager.updatePurchaseOrderStatus(poId, updateDto, userId, tx);
  }

  orderLine(
    poId: string,
    skuId: string,
    dto: OrderPurchaseOrderLineDto,
    userId: string,
    tx?: DbTx,
  ): Promise<PurchaseOrderResponse> {
    return this.manager.orderLine(poId, skuId, dto, userId, tx);
  }

  markLineUnavailable(
    poId: string,
    skuId: string,
    dto: MarkLineUnavailableDto,
    userId: string,
    tx?: DbTx,
  ): Promise<PurchaseOrderResponse> {
    return this.manager.markLineUnavailable(poId, skuId, dto, userId, tx);
  }

  updatePurchaseOrderLines(
    poId: string,
    updateDto: UpdatePurchaseOrderLinesDto,
    tx?: DbTx,
  ): Promise<PurchaseOrderResponse> {
    return this.manager.updatePurchaseOrderLines(poId, updateDto, tx);
  }

  // ========== 조회 (Reader 소유) ==========

  getPurchaseOrderById(poId: string, tx?: DbTx): Promise<PurchaseOrderResponse> {
    return this.reader.findById(poId, tx);
  }

  getPurchaseOrders(
    status?: PurchaseOrderStatus,
    type?: PurchaseOrderType,
    limit = 50,
    offset = 0,
    tx?: DbTx,
  ): Promise<PurchaseOrderResponse[]> {
    return this.reader.findMany(status, type, limit, offset, tx);
  }
}
