import { Injectable, Logger } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { ForbiddenError, NotFoundError } from '@app/shared';
import { and, count, desc, eq, isNotNull, isNull } from 'drizzle-orm';

import {
  type LibrarySchema,
  digitalAssetFileVersions,
  digitalAssetOwnerships,
  digitalAssets,
} from '../schema/library.schema';
import {
  OwnershipListResponseDto,
  OwnershipResponseDto,
} from '../dto/ownership-response.dto';

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

  // ── private ────────────────────────────────────────────────────────────────

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
