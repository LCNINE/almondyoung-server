import { Injectable, Logger, Optional } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { NotFoundError, BadRequestError } from '@app/shared';
import { and, count, desc, eq, ilike, isNull, max as drizzleMax, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { type LibrarySchema, digitalAssets, digitalAssetFileVersions } from '../schema/library.schema';
import { CreateDigitalAssetDto } from '../dto/create-digital-asset.dto';
import { UpdateDigitalAssetDto } from '../dto/update-digital-asset.dto';
import { CreateFileVersionDto } from '../dto/create-file-version.dto';
import {
  DigitalAssetFileVersionDto,
  DigitalAssetListResponseDto,
  DigitalAssetResponseDto,
} from '../dto/digital-asset-response.dto';
import { FileServiceClient } from '../clients/file-service.client';

type Tx = Parameters<Parameters<DbService<LibrarySchema>['db']['transaction']>[0]>[0];
const DIGITAL_ASSET_FILE_CONTEXT_ID = 'digital-asset-file';

@Injectable()
export class DigitalAssetService {
  private readonly logger = new Logger(DigitalAssetService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<LibrarySchema>,
    @Optional() private readonly fileServiceClient?: FileServiceClient,
  ) {}

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
    if (dto.initialFileId) {
      await this._assertFileReferenceUsable(dto.initialFileId);
    }

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

      const patch: Partial<typeof digitalAssets.$inferInsert> = {
        updatedAt: new Date(),
        updatedBy: operatorId,
      };
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

      const [{ value: total }] = await trx.select({ value: count() }).from(digitalAssets).where(whereExpr);

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
    await this._assertFileReferenceUsable(dto.fileId);

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

  /**
   * 자산의 currentFileVersionId 를 과거 file version 으로 되돌린다 (rollback).
   *
   * - 옛 file version row 는 그대로 보존 (immutable history). file-service 의 fileId 도 삭제하지 않음.
   * - 운영자가 잘못 올린 새 파일을 운영 중에 빠르게 되돌리는 용도. 후속 ownership 보유자의
   *   다운로드는 즉시 옛 파일을 받게 된다.
   *
   * @throws NotFoundError asset 또는 versionId 가 없거나 asset 에 속하지 않을 때
   * @throws BadRequestError 이미 그 version 이 current 일 때 (no-op 차단)
   */
  async rollbackToFileVersion(
    assetId: string,
    versionId: string,
    operatorId: string | undefined,
    tx?: Tx,
  ): Promise<DigitalAssetResponseDto> {
    return this.inTx(async (trx) => {
      const [assetRow] = await trx.select().from(digitalAssets).where(eq(digitalAssets.id, assetId));
      if (!assetRow || assetRow.deletedAt) {
        throw new NotFoundError(`Digital asset not found: ${assetId}`);
      }

      const [versionRow] = await trx
        .select({
          id: digitalAssetFileVersions.id,
          assetId: digitalAssetFileVersions.assetId,
        })
        .from(digitalAssetFileVersions)
        .where(eq(digitalAssetFileVersions.id, versionId));
      if (!versionRow || versionRow.assetId !== assetId) {
        throw new NotFoundError(`File version ${versionId} does not belong to asset ${assetId}`);
      }

      if (assetRow.currentFileVersionId === versionId) {
        throw new BadRequestError(`File version ${versionId} is already the current version of asset ${assetId}`);
      }

      await trx
        .update(digitalAssets)
        .set({
          currentFileVersionId: versionId,
          updatedAt: new Date(),
          updatedBy: operatorId,
        })
        .where(eq(digitalAssets.id, assetId));

      return this._loadAssetOrThrow(assetId, trx);
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
      .set({
        currentFileVersionId: versionId,
        updatedAt: new Date(),
        updatedBy: operatorId,
      })
      .where(eq(digitalAssets.id, assetId));

    const [row] = await trx.select().from(digitalAssetFileVersions).where(eq(digitalAssetFileVersions.id, versionId));
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

  private async _assertFileReferenceUsable(fileId: string): Promise<void> {
    if (!this.fileServiceClient) return;

    let metadata: Awaited<ReturnType<FileServiceClient['fetchMetadata']>>;
    try {
      metadata = await this.fileServiceClient.fetchMetadata(fileId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`file-service metadata validation failed for ${fileId}: ${message}`);
      throw new BadRequestError(`file-service file not found or not readable: ${fileId}`);
    }

    if (metadata.status !== 'active') {
      throw new BadRequestError(`file-service file is not active: ${fileId}`);
    }

    if (metadata.contextId !== DIGITAL_ASSET_FILE_CONTEXT_ID) {
      throw new BadRequestError(`file-service file must use context ${DIGITAL_ASSET_FILE_CONTEXT_ID}: ${fileId}`);
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
