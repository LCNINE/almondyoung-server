import { Injectable, Logger } from '@nestjs/common';
import { AnyTx, DbService, InjectDb, TxFor } from '@app/db';
import { NotFoundError } from '@app/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import {
  type LibrarySchema,
  digitalAssets,
  productVariantDigitalAssetLinks,
  digitalAssetFileVersions,
} from '../schema/library.schema';
import {
  DigitalAssetFileVersionDto,
  DigitalAssetResponseDto,
} from '../dto/digital-asset-response.dto';

// Canonical per-BC tx type for this service's own transactions.
// AnyTx (imported from @app/db) is used by cross-BC seam methods (cloneLinksForVariant, inheritLinksFromTwins, listAssetsForVariant).
type LibraryTx = TxFor<LibrarySchema>;

@Injectable()
export class VariantAssetLinkService {
  private readonly logger = new Logger(VariantAssetLinkService.name);

  constructor(@InjectDb() private readonly dbService: DbService<LibrarySchema>) {}

  // tx 는 AnyTx 로 받아 다른 BC(catalog publish 등)의 트랜잭션도 그대로 전달할 수 있게 한다.
  // (동일 DB 내 테이블이라 런타임 안전; cloneLinksForVariant 와 동일한 cross-module tx 컨벤션)
  async listAssetsForVariant(variantId: string, tx?: AnyTx): Promise<DigitalAssetResponseDto[]> {
    return this.dbService.run(async (trx) => {
      const rows = await trx
        .select()
        .from(productVariantDigitalAssetLinks)
        .innerJoin(digitalAssets, eq(productVariantDigitalAssetLinks.assetId, digitalAssets.id))
        .where(
          and(
            eq(productVariantDigitalAssetLinks.variantId, variantId),
            isNull(digitalAssets.deletedAt),
          ),
        );

      const versionIds = rows
        .map((r) => r.digital_assets.currentFileVersionId)
        .filter((v): v is string => !!v);
      const versions = await this._loadFileVersions(versionIds, trx);

      return rows.map((r) => {
        const a = r.digital_assets;
        return {
          id: a.id,
          name: a.name,
          description: a.description,
          mimeType: a.mimeType,
          thumbnailUrl: a.thumbnailUrl,
          currentFileVersionId: a.currentFileVersionId,
          currentFileVersion: versions.get(a.currentFileVersionId ?? '') ?? null,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
        };
      });
    }, tx as LibraryTx | undefined);
  }

  /**
   * variant 의 매칭 asset 집합을 주어진 assetIds 로 완전 교체 (replace).
   */
  async setLinksForVariant(
    variantId: string,
    assetIds: string[],
    operatorId: string | undefined,
    tx?: LibraryTx,
  ): Promise<void> {
    return this.dbService.run(async (trx) => {
      const unique = Array.from(new Set(assetIds));
      if (unique.length > 0) {
        const existing = await trx
          .select({ id: digitalAssets.id })
          .from(digitalAssets)
          .where(and(inArray(digitalAssets.id, unique), isNull(digitalAssets.deletedAt)));
        if (existing.length !== unique.length) {
          const found = new Set(existing.map((r) => r.id));
          const missing = unique.filter((id) => !found.has(id));
          throw new NotFoundError(`Digital asset not found: ${missing.join(', ')}`);
        }
      }

      await trx
        .delete(productVariantDigitalAssetLinks)
        .where(eq(productVariantDigitalAssetLinks.variantId, variantId));

      if (unique.length > 0) {
        await trx.insert(productVariantDigitalAssetLinks).values(
          unique.map((assetId) => ({
            variantId,
            assetId,
            createdBy: operatorId,
          })),
        );
      }
    }, tx);
  }

  async addLink(
    variantId: string,
    assetId: string,
    operatorId: string | undefined,
    tx?: LibraryTx,
  ): Promise<void> {
    return this.dbService.run(async (trx) => {
      const [asset] = await trx
        .select({ id: digitalAssets.id, deletedAt: digitalAssets.deletedAt })
        .from(digitalAssets)
        .where(eq(digitalAssets.id, assetId));
      if (!asset || asset.deletedAt) {
        throw new NotFoundError(`Digital asset not found: ${assetId}`);
      }
      await trx
        .insert(productVariantDigitalAssetLinks)
        .values({ variantId, assetId, createdBy: operatorId })
        .onConflictDoNothing();
    }, tx);
  }

  async removeLink(variantId: string, assetId: string, tx?: LibraryTx): Promise<void> {
    return this.dbService.run(async (trx) => {
      await trx
        .delete(productVariantDigitalAssetLinks)
        .where(
          and(
            eq(productVariantDigitalAssetLinks.variantId, variantId),
            eq(productVariantDigitalAssetLinks.assetId, assetId),
          ),
        );
    }, tx);
  }

  /**
   * variant CoW 시 호출. source variant 의 asset link 정션을 target variant 로 복제.
   * source 가 매칭 없으면 no-op. 자세한 결정은 `docs/adr/0004`.
   */
  async cloneLinksForVariant(sourceVariantId: string, targetVariantId: string, tx: AnyTx): Promise<void> {
    const sources = await tx
      .select({ assetId: productVariantDigitalAssetLinks.assetId })
      .from(productVariantDigitalAssetLinks)
      .where(eq(productVariantDigitalAssetLinks.variantId, sourceVariantId));
    if (sources.length === 0) return;

    await tx.insert(productVariantDigitalAssetLinks).values(
      sources.map((s) => ({
        variantId: targetVariantId,
        assetId: s.assetId,
      })),
    );
  }

  /**
   * publish 시 호출. unmatched variant 각각에 대해 이전 active variant 의 asset link 를
   * 같은 옵션 조합 기준으로 인계한다 (SKU 매칭 인계와 대칭 패턴).
   *
   * @param links inheritance plan: 새 variantId -> 이전 variantId
   * @returns 실제 인계된 variant 수
   */
  async inheritLinksFromTwins(
    links: Array<{ newVariantId: string; previousVariantId: string }>,
    tx: AnyTx,
  ): Promise<number> {
    if (links.length === 0) return 0;

    const prevVariantIds = Array.from(new Set(links.map((l) => l.previousVariantId)));
    const prevLinks = await tx
      .select({
        variantId: productVariantDigitalAssetLinks.variantId,
        assetId: productVariantDigitalAssetLinks.assetId,
      })
      .from(productVariantDigitalAssetLinks)
      .where(inArray(productVariantDigitalAssetLinks.variantId, prevVariantIds));

    if (prevLinks.length === 0) return 0;

    const byPrev = new Map<string, string[]>();
    for (const l of prevLinks) {
      const arr = byPrev.get(l.variantId) ?? [];
      arr.push(l.assetId);
      byPrev.set(l.variantId, arr);
    }

    const rows: Array<{ variantId: string; assetId: string }> = [];
    let inheritedCount = 0;
    for (const { newVariantId, previousVariantId } of links) {
      const assetIds = byPrev.get(previousVariantId);
      if (!assetIds || assetIds.length === 0) continue;
      for (const assetId of assetIds) {
        rows.push({ variantId: newVariantId, assetId });
      }
      inheritedCount++;
    }

    if (rows.length > 0) {
      await tx.insert(productVariantDigitalAssetLinks).values(rows).onConflictDoNothing();
    }
    return inheritedCount;
  }

  // ── private ────────────────────────────────────────────────────────────────

  private async _loadFileVersions(
    versionIds: string[],
    trx: LibraryTx,
  ): Promise<Map<string, DigitalAssetFileVersionDto>> {
    if (versionIds.length === 0) return new Map();
    const rows = await trx
      .select()
      .from(digitalAssetFileVersions)
      .where(inArray(digitalAssetFileVersions.id, versionIds));
    return new Map(rows.map((r) => [r.id, r]));
  }
}
