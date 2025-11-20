import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { walletSchema } from '../../shared/database/schema';
import * as schema from '../../shared/database/schema';
import { eq } from 'drizzle-orm';
import type {
  TaxInvoiceSnapshot,
  NewTaxInvoiceSnapshot,
  TaxInvoiceSnapshotPayload,
} from '../../shared/database/types';
import type { WalletExecutor } from '../../shared/database';

/**
 * TaxInvoiceSnapshotRepository (Data Access Layer)
 *
 * 책임: TaxInvoiceSnapshot 데이터 접근 (홈택스 제출용 스냅샷)
 */
@Injectable()
export class TaxInvoiceSnapshotRepository {
  private readonly logger = new Logger(TaxInvoiceSnapshotRepository.name);

  constructor(private readonly db: DbService<typeof walletSchema>) {}

  /**
   * 세금계산서 ID로 스냅샷 조회
   */
  async findByInvoiceId(
    invoiceId: string,
    tx?: WalletExecutor,
  ): Promise<TaxInvoiceSnapshot | null> {
    const executor = tx || this.db.db;
    const [snapshot] = await executor
      .select()
      .from(schema.taxInvoiceSnapshots)
      .where(eq(schema.taxInvoiceSnapshots.invoiceId, invoiceId))
      .limit(1);
    return snapshot ?? null;
  }

  /**
   * 스냅샷 생성 (홈택스 제출용 완전한 데이터)
   */
  async create(
    data: NewTaxInvoiceSnapshot,
    tx?: WalletExecutor,
  ): Promise<TaxInvoiceSnapshot> {
    const executor = tx || this.db.db;
    const [created] = await executor
      .insert(schema.taxInvoiceSnapshots)
      .values(data)
      .returning();

    this.logger.log(
      `TaxInvoiceSnapshot created for invoice: ${created.invoiceId}`,
    );
    return created;
  }

  /**
   * 스냅샷 업데이트 (부분 환불 등으로 금액 변경 시)
   */
  async update(
    invoiceId: string,
    payload: TaxInvoiceSnapshotPayload,
    tx?: WalletExecutor,
  ): Promise<void> {
    const executor = tx || this.db.db;
    await executor
      .update(schema.taxInvoiceSnapshots)
      .set({ payload: payload as any })
      .where(eq(schema.taxInvoiceSnapshots.invoiceId, invoiceId));

    this.logger.log(`TaxInvoiceSnapshot updated for invoice: ${invoiceId}`);
  }

  /**
   * 스냅샷 삭제
   */
  async delete(invoiceId: string, tx?: WalletExecutor): Promise<void> {
    const executor = tx || this.db.db;
    await executor
      .delete(schema.taxInvoiceSnapshots)
      .where(eq(schema.taxInvoiceSnapshots.invoiceId, invoiceId));

    this.logger.warn(`TaxInvoiceSnapshot deleted for invoice: ${invoiceId}`);
  }
}

