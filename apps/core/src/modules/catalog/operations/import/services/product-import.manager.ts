import { Injectable } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import { type PimSchema, productImportSessions, productImportItems } from '../../../schema/catalog.schema';
import { UpdateProductMasterVersion } from '../../../catalog.types';
import { ProductMastersService } from '../../../core/products/services/product-masters.service';
import { ProductVersionsService } from '../../../core/products/services/product-versions.service';
import { ProductImportSessionReader, ItemRow } from './product-import-session.reader';
import { ProductRecord } from '../dto/import.types';

export interface CommitItem {
  rowNumber: number;
  productKey: string;
  status: 'created' | 'failed';
  masterId?: string;
  errorMessage?: string;
}

export interface CommitResult {
  sessionId: string;
  createdCount: number;
  failedCount: number;
  items: CommitItem[];
}

@Injectable()
export class ProductImportManager {
  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly reader: ProductImportSessionReader,
    private readonly productMastersService: ProductMastersService,
    private readonly productVersionsService: ProductVersionsService,
  ) {}

  async commit(input: { fileName: string; userId: string; records: ProductRecord[] }): Promise<CommitResult> {
    const { fileName, userId, records } = input;

    const [session] = await this.db.run((trx) =>
      trx
        .insert(productImportSessions)
        .values({ fileName, uploadedBy: userId, totalRows: records.length, status: 'completed' })
        .returning(),
    );
    const sessionId = session.id;

    const items: CommitItem[] = [];
    let createdCount = 0;
    let failedCount = 0;

    for (const record of records) {
      if (record.errors.length > 0) {
        const errorMessage = record.errors.map((e) => `[${e.sheet} ${e.rowNumber}행] ${e.message}`).join('; ');
        await this.recordItem(sessionId, record, 'failed', null, errorMessage);
        items.push({ rowNumber: record.rowNumber, productKey: record.productKey, status: 'failed', errorMessage });
        failedCount += 1;
        continue;
      }

      try {
        const masterId = await this.db.run(async (trx) => {
          const version = await this.productMastersService.createMaster(userId, trx);
          const data: UpdateProductMasterVersion = {
            ...record.version,
            categoryIds: record.categoryIds,
            primaryCategoryId: record.primaryCategoryId,
            optionDiff: record.options.length > 0 ? { add: record.options } : undefined,
          };
          await this.productMastersService.updateVersion(version.id, data, trx);
          await trx.insert(productImportItems).values({
            sessionId,
            rowNumber: record.rowNumber,
            productKey: record.productKey,
            status: 'created',
            masterId: version.masterId,
          });
          return version.masterId;
        });
        items.push({ rowNumber: record.rowNumber, productKey: record.productKey, status: 'created', masterId });
        createdCount += 1;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';
        await this.recordItem(sessionId, record, 'failed', null, errorMessage);
        items.push({ rowNumber: record.rowNumber, productKey: record.productKey, status: 'failed', errorMessage });
        failedCount += 1;
      }
    }

    await this.db.run((trx) =>
      trx
        .update(productImportSessions)
        .set({ createdCount, failedCount, committedAt: new Date() })
        .where(eq(productImportSessions.id, sessionId)),
    );

    return { sessionId, createdCount, failedCount, items };
  }

  private recordItem(
    sessionId: string,
    record: ProductRecord,
    status: 'created' | 'failed',
    masterId: string | null,
    errorMessage: string | null,
  ) {
    return this.db.run((trx) =>
      trx.insert(productImportItems).values({
        sessionId,
        rowNumber: record.rowNumber,
        productKey: record.productKey,
        status,
        masterId: masterId ?? undefined,
        errorMessage: errorMessage ?? undefined,
      }),
    );
  }

  async publishSession(
    sessionId: string,
  ): Promise<{ published: number; failed: { masterId: string; reason: string }[] }> {
    const { items } = await this.reader.getSession(sessionId);
    const created = items.filter(
      (i): i is ItemRow & { masterId: string } => i.status === 'created' && i.masterId !== null,
    );

    let published = 0;
    const failed: { masterId: string; reason: string }[] = [];

    for (const item of created) {
      const { masterId } = item;
      try {
        const draftVersionId = await this.reader.getDraftVersionId(masterId);
        if (!draftVersionId) continue; // 이미 publish 됨(active) → skip (멱등)
        await this.db.run((trx) => this.productVersionsService.publishVersion(draftVersionId, trx));
        published += 1;
      } catch (error) {
        failed.push({ masterId, reason: error instanceof Error ? error.message : '알 수 없는 오류' });
      }
    }

    return { published, failed };
  }
}
