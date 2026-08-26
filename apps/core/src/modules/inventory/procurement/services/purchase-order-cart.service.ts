import { Injectable, Logger } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { eq, and, desc, sql, SQL } from 'drizzle-orm';
import { NotFoundError } from '@app/shared';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { AddToCartDto, UpdateCartItemDto, CartItemResponse, PurchaseOrderType } from '../dto/purchase-order.dto';

/**
 * 발주대기리스트(카트) CRUD. **단일 service 로 둔다** — 검증이 "내 것인가"
 * (`createdBy = userId`) 하나뿐이라 manager/reader 로 나눌 실익이 없다.
 *
 * ⚠️ 카트 행을 읽는 곳이 여기 말고 하나 더 있다: `PurchaseOrderService.createPurchaseOrderFromCart`.
 * 그건 카트를 읽어 발주를 만드는 것을 **한 트랜잭션**으로 해야 해서 이리로 옮길 수 없다.
 * 중복이 아니라 원자성 요구다 — 카트를 먼저 읽고 발주를 따로 만들면 그 사이에 카트가
 * 바뀔 수 있다.
 *
 * 잠금 불변식(PO 행 → 라인 행)은 이 파일과 무관하다 — 카트는 발주 행을 잠그지 않는다.
 */
@Injectable()
export class PurchaseOrderCartService {
  private readonly logger = new Logger(PurchaseOrderCartService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

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
      throw new NotFoundError(`Cart item with ID ${itemId} not found or you don't have permission to modify it`);
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
      throw new NotFoundError(`Cart item with ID ${itemId} not found or you don't have permission to delete it`);
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
      throw new NotFoundError(`Cart item with ID ${itemId} not found`);
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
}
