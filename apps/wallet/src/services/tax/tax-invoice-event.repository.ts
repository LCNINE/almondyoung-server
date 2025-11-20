import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { walletSchema } from '../../shared/database/schema';
import * as schema from '../../shared/database/schema';
import { eq, desc } from 'drizzle-orm';
import type {
  TaxInvoiceEvent,
  NewTaxInvoiceEvent,
} from '../../shared/database/types';
import type { WalletExecutor } from '../../shared/database';

/**
 * TaxInvoiceEventRepository (Data Access Layer)
 *
 * 책임: TaxInvoiceEvent 데이터 접근 (Audit 로그)
 */
@Injectable()
export class TaxInvoiceEventRepository {
  private readonly logger = new Logger(TaxInvoiceEventRepository.name);

  constructor(private readonly db: DbService<typeof walletSchema>) {}

  /**
   * 감사 이벤트 생성
   */
  async create(
    data: NewTaxInvoiceEvent,
    tx?: WalletExecutor,
  ): Promise<TaxInvoiceEvent> {
    const executor = tx || this.db.db;
    const [created] = await executor
      .insert(schema.taxInvoiceEvents)
      .values(data)
      .returning();

    this.logger.log(
      `TaxInvoiceEvent logged: ${created.eventType} for invoice ${created.invoiceId}`,
    );
    return created;
  }

  /**
   * 특정 세금계산서의 모든 이벤트 조회
   */
  async findByInvoiceId(
    invoiceId: string,
    tx?: WalletExecutor,
  ): Promise<TaxInvoiceEvent[]> {
    const executor = tx || this.db.db;
    return await executor
      .select()
      .from(schema.taxInvoiceEvents)
      .where(eq(schema.taxInvoiceEvents.invoiceId, invoiceId))
      .orderBy(desc(schema.taxInvoiceEvents.createdAt));
  }

  /**
   * 특정 이벤트 타입으로 조회
   */
  async findByEventType(
    eventType: string,
    limit: number = 100,
  ): Promise<TaxInvoiceEvent[]> {
    return await this.db.db
      .select()
      .from(schema.taxInvoiceEvents)
      .where(eq(schema.taxInvoiceEvents.eventType, eventType))
      .orderBy(desc(schema.taxInvoiceEvents.createdAt))
      .limit(limit);
  }
}

