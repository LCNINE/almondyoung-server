import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, eq } from 'drizzle-orm';
import { WalletSchema, providerWebhookReceipts } from '../schema';
import { NewProviderWebhookReceipt } from '../types';

@Injectable()
export class TossWebhookRepository {
  constructor(private readonly dbService: DbService<WalletSchema>) {}

  async insertOrIgnore(data: NewProviderWebhookReceipt): Promise<{ inserted: boolean; id: string }> {
    const rows = await this.dbService.db
      .insert(providerWebhookReceipts)
      .values(data)
      .onConflictDoNothing()
      .returning({ id: providerWebhookReceipts.id });

    if (rows[0]) {
      return { inserted: true, id: rows[0].id };
    }

    // Conflict: fetch the existing record's id
    const existing = await this.dbService.db
      .select({ id: providerWebhookReceipts.id })
      .from(providerWebhookReceipts)
      .where(
        and(
          eq(providerWebhookReceipts.providerType, data.providerType),
          eq(providerWebhookReceipts.providerEventId, data.providerEventId),
        ),
      )
      .limit(1);

    return { inserted: false, id: existing[0].id };
  }

  async updateStatus(
    id: string,
    status: 'PROCESSED' | 'IGNORED_DUPLICATE' | 'FAILED',
    extra?: { errorCode?: string; errorMessage?: string; processedAt?: Date },
  ): Promise<void> {
    await this.dbService.db
      .update(providerWebhookReceipts)
      .set({
        status,
        updatedAt: new Date(),
        ...(extra?.errorCode !== undefined ? { lastErrorCode: extra.errorCode } : {}),
        ...(extra?.errorMessage !== undefined ? { lastErrorMessage: extra.errorMessage } : {}),
        ...(extra?.processedAt !== undefined ? { processedAt: extra.processedAt } : {}),
      })
      .where(eq(providerWebhookReceipts.id, id));
  }
}
