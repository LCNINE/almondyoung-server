import { Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, eq } from 'drizzle-orm';
import { WalletSchema, paymentMethods } from '../schema';
import { DbTx, PaymentMethod } from '../types';
import { ProviderRegistry } from '../providers/provider.registry';
import { CreatePaymentMethodDto } from './dto';

@Injectable()
export class PaymentMethodsService {
  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly providerRegistry: ProviderRegistry,
  ) {}

  async create(dto: CreatePaymentMethodDto): Promise<PaymentMethod> {
    const provider = this.providerRegistry.getProviderOrThrow(dto.type);

    await provider.validateMethod({
      userId: dto.userId,
      type: dto.type,
      providerData: dto.providerData,
    });

    const rows = await this.dbService.db
      .insert(paymentMethods)
      .values({
        userId: dto.userId,
        type: dto.type,
        displayName: dto.displayName ?? null,
        isReusable: true,
        isDeleted: false,
        providerData: dto.providerData ?? {},
      })
      .returning();

    const method = rows[0];
    if (!method) {
      throw new Error('PAYMENT_METHOD_INSERT_FAILED');
    }
    return method;
  }

  async findAllByUserId(userId: string): Promise<PaymentMethod[]> {
    const results = await Promise.all(this.providerRegistry.all().map((p) => p.getUserMethods(userId)));
    return results.flat();
  }

  async findOrCreatePointsMethod(userId: string, tx?: DbTx): Promise<PaymentMethod> {
    const db = tx ?? this.dbService.db;
    const existing = await (db as typeof this.dbService.db)
      .select()
      .from(paymentMethods)
      .where(
        and(eq(paymentMethods.userId, userId), eq(paymentMethods.type, 'POINTS'), eq(paymentMethods.isDeleted, false)),
      )
      .limit(1);

    if (existing[0]) return existing[0];

    const rows = await (db as typeof this.dbService.db)
      .insert(paymentMethods)
      .values({
        userId,
        type: 'POINTS',
        displayName: null,
        isReusable: true,
        isDeleted: false,
        providerData: {},
      })
      .returning();

    const method = rows[0];
    if (!method) throw new Error('POINTS_METHOD_INSERT_FAILED');
    return method;
  }

  async findById(id: string, tx?: DbTx): Promise<PaymentMethod | null> {
    const db = tx ?? this.dbService.db;
    const rows = await (db as typeof this.dbService.db)
      .select()
      .from(paymentMethods)
      .where(and(eq(paymentMethods.id, id), eq(paymentMethods.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  async delete(id: string): Promise<void> {
    const method = await this.findById(id);
    if (!method) {
      throw new NotFoundException({ error: 'PAYMENT_METHOD_NOT_FOUND', message: `Payment method not found: ${id}` });
    }

    const provider = this.providerRegistry.getProviderOrThrow(method.type);

    await provider.deleteMethod({
      userId: method.userId,
      paymentMethodId: id,
      providerData: method.providerData,
    });

    await this.dbService.db
      .update(paymentMethods)
      .set({ isDeleted: true, updatedAt: new Date() })
      .where(eq(paymentMethods.id, id));
  }
}
