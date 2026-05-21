import { Injectable, Logger } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { NotFoundError, BadRequestError } from '@app/shared';
import { and, asc, count, desc, eq, ilike, isNull, max as drizzleMax, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import {
  type LibrarySchema,
  digitalAssets,
  digitalAssetFileVersions,
} from '../schema/library.schema';
import { CreateDigitalAssetDto } from '../dto/create-digital-asset.dto';
import { UpdateDigitalAssetDto } from '../dto/update-digital-asset.dto';
import { CreateFileVersionDto } from '../dto/create-file-version.dto';
import {
  DigitalAssetFileVersionDto,
  DigitalAssetListResponseDto,
  DigitalAssetResponseDto,
} from '../dto/digital-asset-response.dto';

type Tx = Parameters<Parameters<DbService<LibrarySchema>['db']['transaction']>[0]>[0];

@Injectable()
export class DigitalAssetService {
  private readonly logger = new Logger(DigitalAssetService.name);

  constructor(@InjectDb() private readonly dbService: DbService<LibrarySchema>) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: Tx) => Promise<T>, tx?: Tx): Promise<T> {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  async createAsset(
    dto: CreateDigitalAssetDto,
    operatorId: string | undefined,
    tx?: Tx,
  ): Promise<DigitalAssetResponseDto> {
    return this.inTx(async (trx) => {
      const assetId = uuidv7();
      await trx.insert(digitalAssets).values({
        id: assetId,
        name: dto.name,
        description: dto.description,
        mimeType: dto.mimeType,
        thumbnailUrl: dto.thumbnailUrl,
        createdBy: operatorId,
        updatedBy: operatorId,
      });

      if (dto.initialFileId) {
        await this._insertFileVersion(
          assetId,
          { fileId: dto.initialFileId, releaseNote: dto.initialReleaseNote },
          operatorId,
          trx,
        );
      }

      return this._loadAssetOrThrow(assetId, trx);
    }, tx);
  }

  async updateAsset(
    assetId: string,
    dto: UpdateDigitalAssetDto,
    operatorId: string | undefined,
    tx?: Tx,
  ): Promise<DigitalAssetResponseDto> {
    return this.inTx(async (trx) => {
      await this._assertAssetExists(assetId, trx);

      const patch: Partial<typeof digitalAssets.$inferInsert> = { updatedAt: new Date(), updatedBy: operatorId };
      if (dto.name !== undefined) patch.name = dto.name;
      if (dto.description !== undefined) patch.description = dto.description;
      if (dto.mimeType !== undefined) patch.mimeType = dto.mimeType;
      if (dto.thumbnailUrl !== undefined) patch.thumbnailUrl = dto.thumbnailUrl;

      await trx.update(digitalAssets).set(patch).where(eq(digitalAssets.id, assetId));
      return this._loadAssetOrThrow(assetId, trx);
    }, tx);
  }

  async deleteAsset(assetId: string, operatorId: string | undefined, tx?: Tx): Promise<void> {
    return this.inTx(async (trx) => {
      await this._assertAssetExists(assetId, trx);
      await trx
        .update(digitalAssets)
        .set({ deletedAt: new Date(), deletedBy: operatorId, updatedAt: new Date(), updatedBy: operatorId })
        .where(eq(digitalAssets.id, assetId));
    }, tx);
  }

  async getAsset(assetId: string, tx?: Tx): Promise<DigitalAssetResponseDto> {
    return this.inTx((trx) => this._loadAssetOrThrow(assetId, trx), tx);
  }

  async listAssets(
    filters: { q?: string; page?: number; limit?: number } = {},
    tx?: Tx,
  ): Promise<DigitalAssetListResponseDto> {
    return this.inTx(async (trx) => {
      const page = Math.max(1, filters.page ?? 1);
      const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
      const offset = (page - 1) * limit;

      const whereExpr = filters.q
        ? and(isNull(digitalAssets.deletedAt), ilike(digitalAssets.name, `%${filters.q}%`))
        : isNull(digitalAssets.deletedAt);

      const [{ value: total }] = await trx
        .select({ value: count() })
        .from(digitalAssets)
        .where(whereExpr);

      const rows = await trx
        .select()
        .from(digitalAssets)
        .where(whereExpr)
        .orderBy(desc(digitalAssets.createdAt))
        .limit(limit)
        .offset(offset);

      const versionMap = await this._loadCurrentFileVersions(
        rows.map((r) => r.currentFileVersionId).filter((v): v is string => !!v),
        trx,
      );

      return {
        data: rows.map((r) => this._toDto(r, versionMap.get(r.currentFileVersionId ?? '') ?? null)),
        total: Number(total),
        page,
        limit,
      };
    }, tx);
  }

  async addFileVersion(
    assetId: string,
    dto: CreateFileVersionDto,
    operatorId: string | undefined,
    tx?: Tx,
  ): Promise<DigitalAssetFileVersionDto> {
    return this.inTx(async (trx) => {
      await this._assertAssetExists(assetId, trx);
      const row = await this._insertFileVersion(assetId, dto, operatorId, trx);
      return row;
    }, tx);
  }

  async listFileVersions(assetId: string, tx?: Tx): Promise<DigitalAssetFileVersionDto[]> {
    return this.inTx(async (trx) => {
      await this._assertAssetExists(assetId, trx);
      const rows = await trx
        .select()
        .from(digitalAssetFileVersions)
        .where(eq(digitalAssetFileVersions.assetId, assetId))
        .orderBy(desc(digitalAssetFileVersions.version));
      return rows;
    }, tx);
  }

  // ── private ────────────────────────────────────────────────────────────────

  private async _insertFileVersion(
    assetId: string,
    dto: CreateFileVersionDto,
    operatorId: string | undefined,
    trx: Tx,
  ): Promise<DigitalAssetFileVersionDto> {
    const [maxRow] = await trx
      .select({ max: drizzleMax(digitalAssetFileVersions.version) })
      .from(digitalAssetFileVersions)
      .where(eq(digitalAssetFileVersions.assetId, assetId));
    const nextVersion = (maxRow?.max ?? 0) + 1;

    const versionId = uuidv7();
    await trx.insert(digitalAssetFileVersions).values({
      id: versionId,
      assetId,
      version: nextVersion,
      fileId: dto.fileId,
      releaseNote: dto.releaseNote,
      releasedBy: operatorId,
    });

    await trx
      .update(digitalAssets)
      .set({ currentFileVersionId: versionId, updatedAt: new Date(), updatedBy: operatorId })
      .where(eq(digitalAssets.id, assetId));

    const [row] = await trx
      .select()
      .from(digitalAssetFileVersions)
      .where(eq(digitalAssetFileVersions.id, versionId));
    if (!row) {
      throw new Error(`Inserted file version row not found: ${versionId}`);
    }
    return row;
  }

  private async _loadAssetOrThrow(assetId: string, trx: Tx): Promise<DigitalAssetResponseDto> {
    const [row] = await trx.select().from(digitalAssets).where(eq(digitalAssets.id, assetId));
    if (!row || row.deletedAt) {
      throw new NotFoundError(`Digital asset not found: ${assetId}`);
    }

    let currentVersion: DigitalAssetFileVersionDto | null = null;
    if (row.currentFileVersionId) {
      const [v] = await trx
        .select()
        .from(digitalAssetFileVersions)
        .where(eq(digitalAssetFileVersions.id, row.currentFileVersionId));
      currentVersion = v ?? null;
    }
    return this._toDto(row, currentVersion);
  }

  private async _assertAssetExists(assetId: string, trx: Tx): Promise<void> {
    const [row] = await trx
      .select({ id: digitalAssets.id, deletedAt: digitalAssets.deletedAt })
      .from(digitalAssets)
      .where(eq(digitalAssets.id, assetId));
    if (!row || row.deletedAt) {
      throw new NotFoundError(`Digital asset not found: ${assetId}`);
    }
  }

  private async _loadCurrentFileVersions(
    versionIds: string[],
    trx: Tx,
  ): Promise<Map<string, DigitalAssetFileVersionDto>> {
    if (versionIds.length === 0) return new Map();
    const rows = await trx
      .select()
      .from(digitalAssetFileVersions)
      .where(sql`${digitalAssetFileVersions.id} = ANY(${versionIds})`);
    return new Map(rows.map((r) => [r.id, r]));
  }

  private _toDto(
    row: typeof digitalAssets.$inferSelect,
    currentFileVersion: DigitalAssetFileVersionDto | null,
  ): DigitalAssetResponseDto {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      mimeType: row.mimeType,
      thumbnailUrl: row.thumbnailUrl,
      currentFileVersionId: row.currentFileVersionId,
      currentFileVersion,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
