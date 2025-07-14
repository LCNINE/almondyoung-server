import { Injectable } from '@nestjs/common';
import { PaymentMethodStrategy } from './payment.strategy';
import { CreateBnplPaymentMethodDto } from '../dto/create-payment-method.dto';
import { InjectDb } from '@app/db';
import { DbService } from '@app/db/db.service';
import * as schema from '../schema';
import { paymentMethod, bnplMethod } from '../schema';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import { ExtractTablesWithRelations } from 'drizzle-orm';
import { eq } from 'drizzle-orm';

type Transaction = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

@Injectable()
export class BnplPaymentStrategy implements PaymentMethodStrategy {
  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
  ) {}

  supports(methodType: string): boolean {
    return methodType === 'BNPL';
  }

  validate(payload: unknown): void {
    // TODO: BNPL에 특화된 유효성 검사 (필요 시 Zod 스키마 등 사용)
    console.log('Validating BNPL payload:', payload);
  }

  async register(payload: CreateBnplPaymentMethodDto): Promise<{ id: string }> {
    const dto = payload;
    this.validate(dto);

    const newMethodId = await this.dbService.db.transaction(async (tx) => {
      if (dto.isDefault) {
        await this.unsetDefaultForUser(dto.userId, tx);
      }

      const [newMethod] = await tx
        .insert(paymentMethod)
        .values({
          userId: dto.userId,
          methodType: 'BNPL',
          methodName: dto.methodName,
          isDefault: dto.isDefault,
          institutionCode: dto.institutionCode,
          status: 'ACTIVE',
        })
        .returning({ id: paymentMethod.id });

      await tx.insert(bnplMethod).values({
        id: newMethod.id,
        methodType: 'BNPL',
        creditLimit: dto.creditLimit,
        approvedLimit: dto.approvedLimit,
        termsUrl: dto.termsUrl,
      });

      return newMethod.id;
    });

    return { id: newMethodId };
  }

  async delete(paymentMethodId: string): Promise<void> {
    // BNPL은 PG사 연동이 없으므로 DB에서만 soft-delete 처리
    await this.dbService.db
      .update(paymentMethod)
      .set({ status: 'DELETED', updatedAt: new Date() })
      .where(eq(paymentMethod.id, paymentMethodId));
  }

  private async unsetDefaultForUser(
    userId: number,
    tx: Transaction,
  ): Promise<void> {
    await tx
      .update(paymentMethod)
      .set({ isDefault: false })
      .where(eq(paymentMethod.userId, userId));
  }
}
