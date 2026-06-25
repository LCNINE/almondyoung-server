import { Injectable, Logger } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { BadRequestError, ForbiddenError, NotFoundError } from '@app/shared';
import { and, count, desc, eq, isNotNull, isNull, type SQL } from 'drizzle-orm';

import { wmsTables } from '../../inventory/schema/inventory.schema';
import {
  type LibrarySchema,
  digitalAssetFileVersions,
  digitalAssetOwnerships,
  digitalAssets,
  productVariantDigitalAssetLinks,
} from '../schema/library.schema';
import {
  OwnershipListResponseDto,
  OwnershipResponseDto,
} from '../dto/ownership-response.dto';
import {
  AdminOwnershipListResponseDto,
  AdminOwnershipResponseDto,
  AdminOwnershipStatus,
  GrantOwnershipDto,
} from '../dto/admin-ownership.dto';

type Tx = Parameters<Parameters<DbService<LibrarySchema>['db']['transaction']>[0]>[0];

export type OwnershipFilter = 'all' | 'new' | 'used';

/**
 * Storefront 사용자 본인의 ownership 조회/exercise/다운로드 메타 조회.
 *
 * - revoke 된 ownership 은 노출/exercise/다운로드 모두 차단 (ADR-0006).
 * - exercise 는 이미 exercise 된 경우 idempotent — 멱등 성공.
 * - 다운로드 가능 조건: 본인 ownership + exercised + 미revoke + asset 의 currentFileVersion 존재.
 */
@Injectable()
export class OwnershipService {
  private readonly logger = new Logger(OwnershipService.name);

  constructor(@InjectDb() private readonly dbService: DbService<LibrarySchema>) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: Tx) => Promise<T>, tx?: Tx): Promise<T> {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  async listForCustomer(
    customerId: string,
    opts: { skip?: number; take?: number; filter?: OwnershipFilter } = {},
    tx?: Tx,
  ): Promise<OwnershipListResponseDto> {
    return this.inTx(async (trx) => {
      const skip = Math.max(0, opts.skip ?? 0);
      const take = Math.min(100, Math.max(1, opts.take ?? 20));
      const filter = opts.filter ?? 'all';

      const conditions = [
        eq(digitalAssetOwnerships.customerId, customerId),
        isNull(digitalAssetOwnerships.revokedAt),
      ];
      if (filter === 'new') conditions.push(isNull(digitalAssetOwnerships.exercisedAt));
      if (filter === 'used') conditions.push(isNotNull(digitalAssetOwnerships.exercisedAt));

      const whereExpr = and(...conditions);

      const [{ value: total }] = await trx
        .select({ value: count() })
        .from(digitalAssetOwnerships)
        .where(whereExpr);

      const rows = await trx
        .select({
          ownership: digitalAssetOwnerships,
          asset: digitalAssets,
        })
        .from(digitalAssetOwnerships)
        .innerJoin(digitalAssets, eq(digitalAssetOwnerships.assetId, digitalAssets.id))
        .where(whereExpr)
        .orderBy(desc(digitalAssetOwnerships.grantedAt))
        .limit(take)
        .offset(skip);

      const data: OwnershipResponseDto[] = rows.map((r) => ({
        id: r.ownership.id,
        customerId: r.ownership.customerId,
        assetId: r.ownership.assetId,
        salesOrderId: r.ownership.salesOrderId,
        grantedAt: r.ownership.grantedAt,
        exercisedAt: r.ownership.exercisedAt,
        asset: {
          id: r.asset.id,
          name: r.asset.name,
          description: r.asset.description,
          mimeType: r.asset.mimeType,
          thumbnailUrl: r.asset.thumbnailUrl,
        },
      }));

      return { data, total: Number(total), skip, take };
    }, tx);
  }

  /**
   * exercise: 이미 exercise 됐으면 idempotent 하게 성공 (현재 row 반환).
   */
  async exercise(
    ownershipId: string,
    customerId: string,
    tx?: Tx,
  ): Promise<OwnershipResponseDto> {
    return this.inTx(async (trx) => {
      const ownership = await this._loadOwnedOrThrow(ownershipId, customerId, trx);

      if (!ownership.ownership.exercisedAt) {
        await trx
          .update(digitalAssetOwnerships)
          .set({ exercisedAt: new Date() })
          .where(eq(digitalAssetOwnerships.id, ownershipId));
      }

      // 재조회 후 응답 (asset join 포함)
      const refreshed = await this._loadOwnedOrThrow(ownershipId, customerId, trx);
      return this._toDto(refreshed);
    }, tx);
  }

  /**
   * 다운로드 가능 여부를 검증하고, 다운로드할 fileId 와 파일명 후보를 돌려준다.
   * 컨트롤러가 file-service 로 실제 바이트를 가져와 stream 한다.
   */
  async getDownloadable(
    ownershipId: string,
    customerId: string,
    tx?: Tx,
  ): Promise<{ fileId: string; assetName: string; assetMimeType: string | null }> {
    return this.inTx(async (trx) => {
      const { ownership, asset } = await this._loadOwnedOrThrow(ownershipId, customerId, trx);

      if (!ownership.exercisedAt) {
        throw new ForbiddenError(
          `Ownership not exercised yet — exercise first before download: ${ownershipId}`,
        );
      }
      if (!asset.currentFileVersionId) {
        throw new NotFoundError(`Asset has no current file version: ${asset.id}`);
      }

      const [version] = await trx
        .select({ fileId: digitalAssetFileVersions.fileId })
        .from(digitalAssetFileVersions)
        .where(eq(digitalAssetFileVersions.id, asset.currentFileVersionId));

      if (!version) {
        throw new NotFoundError(`File version row missing: ${asset.currentFileVersionId}`);
      }

      return {
        fileId: version.fileId,
        assetName: asset.name,
        assetMimeType: asset.mimeType,
      };
    }, tx);
  }

  // ── admin ────────────────────────────────────────────────────────────────

  /**
   * 어드민 ownership 조회. customer/asset/order 로 필터하며 revoke 된 항목도
   * status 에 따라 함께 노출한다 (운영 추적용).
   */
  async listForAdmin(
    opts: {
      customerId?: string;
      assetId?: string;
      salesOrderId?: string;
      status?: AdminOwnershipStatus;
      skip?: number;
      take?: number;
    } = {},
    tx?: Tx,
  ): Promise<AdminOwnershipListResponseDto> {
    return this.inTx(async (trx) => {
      const skip = Math.max(0, opts.skip ?? 0);
      const take = Math.min(100, Math.max(1, opts.take ?? 20));
      const status = opts.status ?? 'all';

      const conditions: SQL[] = [];
      if (opts.customerId) conditions.push(eq(digitalAssetOwnerships.customerId, opts.customerId));
      if (opts.assetId) conditions.push(eq(digitalAssetOwnerships.assetId, opts.assetId));
      if (opts.salesOrderId) conditions.push(eq(digitalAssetOwnerships.salesOrderId, opts.salesOrderId));
      if (status === 'active') conditions.push(isNull(digitalAssetOwnerships.revokedAt));
      if (status === 'revoked') conditions.push(isNotNull(digitalAssetOwnerships.revokedAt));

      const whereExpr = conditions.length ? and(...conditions) : undefined;

      const [{ value: total }] = await trx
        .select({ value: count() })
        .from(digitalAssetOwnerships)
        .where(whereExpr);

      const rows = await trx
        .select({ ownership: digitalAssetOwnerships, asset: digitalAssets })
        .from(digitalAssetOwnerships)
        .innerJoin(digitalAssets, eq(digitalAssetOwnerships.assetId, digitalAssets.id))
        .where(whereExpr)
        .orderBy(desc(digitalAssetOwnerships.grantedAt))
        .limit(take)
        .offset(skip);

      return {
        data: rows.map((r) => this._toAdminDto(r)),
        total: Number(total),
        skip,
        take,
      };
    }, tx);
  }

  /**
   * 어드민 수동 부여. (customerId, assetId, salesOrderId) unique 로 멱등 —
   * 이미 있으면 기존 row 를 그대로 돌려준다.
   */
  async grantManual(dto: GrantOwnershipDto, tx?: Tx): Promise<AdminOwnershipResponseDto> {
    return this.inTx(async (trx) => {
      const [asset] = await trx
        .select({ id: digitalAssets.id })
        .from(digitalAssets)
        .where(eq(digitalAssets.id, dto.assetId));
      if (!asset) {
        throw new NotFoundError(`Asset not found: ${dto.assetId}`);
      }
      await this._assertManualGrantMatchesOrder(dto, trx);

      await trx
        .insert(digitalAssetOwnerships)
        .values({
          customerId: dto.customerId,
          assetId: dto.assetId,
          salesOrderId: dto.salesOrderId,
        })
        .onConflictDoNothing({
          target: [
            digitalAssetOwnerships.customerId,
            digitalAssetOwnerships.assetId,
            digitalAssetOwnerships.salesOrderId,
          ],
        });

      const [row] = await trx
        .select({ ownership: digitalAssetOwnerships, asset: digitalAssets })
        .from(digitalAssetOwnerships)
        .innerJoin(digitalAssets, eq(digitalAssetOwnerships.assetId, digitalAssets.id))
        .where(
          and(
            eq(digitalAssetOwnerships.customerId, dto.customerId),
            eq(digitalAssetOwnerships.assetId, dto.assetId),
            eq(digitalAssetOwnerships.salesOrderId, dto.salesOrderId),
          ),
        );

      this.logger.log(
        `Manual digital ownership grant: customerId=${dto.customerId}, assetId=${dto.assetId}, salesOrderId=${dto.salesOrderId}`,
      );

      return this._toAdminDto(row);
    }, tx);
  }

  /**
   * 어드민 강제 회수. exercise 여부와 무관하게 revoke 한다 (고객 본인 다운로드 차단용).
   */
  async adminRevoke(ownershipId: string, reason: string | null, tx?: Tx): Promise<AdminOwnershipResponseDto> {
    return this.inTx(async (trx) => {
      const updated = await trx
        .update(digitalAssetOwnerships)
        .set({ revokedAt: new Date(), revokedReason: reason })
        .where(eq(digitalAssetOwnerships.id, ownershipId))
        .returning({ id: digitalAssetOwnerships.id });

      if (updated.length === 0) {
        throw new NotFoundError(`Ownership not found: ${ownershipId}`);
      }
      return this._loadAdminDto(ownershipId, trx);
    }, tx);
  }

  /**
   * 어드민 재활성화. revoke 된 ownership 을 다시 활성화해 고객이 다시 다운로드할 수 있게 한다.
   */
  async adminReactivate(ownershipId: string, tx?: Tx): Promise<AdminOwnershipResponseDto> {
    return this.inTx(async (trx) => {
      const updated = await trx
        .update(digitalAssetOwnerships)
        .set({ revokedAt: null, revokedReason: null })
        .where(eq(digitalAssetOwnerships.id, ownershipId))
        .returning({ id: digitalAssetOwnerships.id });

      if (updated.length === 0) {
        throw new NotFoundError(`Ownership not found: ${ownershipId}`);
      }
      return this._loadAdminDto(ownershipId, trx);
    }, tx);
  }

  // ── private ────────────────────────────────────────────────────────────────

  private async _assertManualGrantMatchesOrder(dto: GrantOwnershipDto, trx: Tx): Promise<void> {
    const [order] = await trx
      .select({ customerId: wmsTables.salesOrders.customerId })
      .from(wmsTables.salesOrders)
      .where(eq(wmsTables.salesOrders.id, dto.salesOrderId));

    if (!order) {
      throw new NotFoundError(`Sales order not found: ${dto.salesOrderId}`);
    }
    if (!order.customerId) {
      throw new BadRequestError(`Sales order has no customer id: ${dto.salesOrderId}`);
    }
    if (order.customerId !== dto.customerId) {
      throw new BadRequestError(
        `Sales order ${dto.salesOrderId} does not belong to customer ${dto.customerId}`,
      );
    }

    const linkedOrderLines = await trx
      .select({ assetId: productVariantDigitalAssetLinks.assetId })
      .from(wmsTables.salesOrderLines)
      .innerJoin(
        productVariantDigitalAssetLinks,
        eq(wmsTables.salesOrderLines.variantId, productVariantDigitalAssetLinks.variantId),
      )
      .where(
        and(
          eq(wmsTables.salesOrderLines.salesOrderId, dto.salesOrderId),
          eq(productVariantDigitalAssetLinks.assetId, dto.assetId),
        ),
      )
      .limit(1);

    if (linkedOrderLines.length === 0) {
      throw new BadRequestError(
        `Asset ${dto.assetId} is not linked to any variant in sales order ${dto.salesOrderId}`,
      );
    }
  }

  private async _loadOwnedOrThrow(
    ownershipId: string,
    customerId: string,
    trx: Tx,
  ): Promise<{
    ownership: typeof digitalAssetOwnerships.$inferSelect;
    asset: typeof digitalAssets.$inferSelect;
  }> {
    const [row] = await trx
      .select({ ownership: digitalAssetOwnerships, asset: digitalAssets })
      .from(digitalAssetOwnerships)
      .innerJoin(digitalAssets, eq(digitalAssetOwnerships.assetId, digitalAssets.id))
      .where(eq(digitalAssetOwnerships.id, ownershipId));

    if (!row) {
      throw new NotFoundError(`Ownership not found: ${ownershipId}`);
    }
    if (row.ownership.customerId !== customerId) {
      // 본인 외 접근은 존재 여부를 노출하지 않기 위해 404 와 동등 취급.
      throw new NotFoundError(`Ownership not found: ${ownershipId}`);
    }
    if (row.ownership.revokedAt) {
      throw new ForbiddenError(`Ownership has been revoked: ${ownershipId}`);
    }
    return row;
  }

  private async _loadAdminDto(ownershipId: string, trx: Tx): Promise<AdminOwnershipResponseDto> {
    const [row] = await trx
      .select({ ownership: digitalAssetOwnerships, asset: digitalAssets })
      .from(digitalAssetOwnerships)
      .innerJoin(digitalAssets, eq(digitalAssetOwnerships.assetId, digitalAssets.id))
      .where(eq(digitalAssetOwnerships.id, ownershipId));

    if (!row) {
      throw new NotFoundError(`Ownership not found: ${ownershipId}`);
    }
    return this._toAdminDto(row);
  }

  private _toAdminDto(row: {
    ownership: typeof digitalAssetOwnerships.$inferSelect;
    asset: typeof digitalAssets.$inferSelect;
  }): AdminOwnershipResponseDto {
    return {
      id: row.ownership.id,
      customerId: row.ownership.customerId,
      assetId: row.ownership.assetId,
      salesOrderId: row.ownership.salesOrderId,
      grantedAt: row.ownership.grantedAt,
      exercisedAt: row.ownership.exercisedAt,
      revokedAt: row.ownership.revokedAt,
      revokedReason: row.ownership.revokedReason,
      asset: {
        id: row.asset.id,
        name: row.asset.name,
        description: row.asset.description,
        mimeType: row.asset.mimeType,
        thumbnailUrl: row.asset.thumbnailUrl,
      },
    };
  }

  private _toDto(row: {
    ownership: typeof digitalAssetOwnerships.$inferSelect;
    asset: typeof digitalAssets.$inferSelect;
  }): OwnershipResponseDto {
    return {
      id: row.ownership.id,
      customerId: row.ownership.customerId,
      assetId: row.ownership.assetId,
      salesOrderId: row.ownership.salesOrderId,
      grantedAt: row.ownership.grantedAt,
      exercisedAt: row.ownership.exercisedAt,
      asset: {
        id: row.asset.id,
        name: row.asset.name,
        description: row.asset.description,
        mimeType: row.asset.mimeType,
        thumbnailUrl: row.asset.thumbnailUrl,
      },
    };
  }
}
