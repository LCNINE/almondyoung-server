import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DbService } from '@app/db';
import { and, eq } from 'drizzle-orm';
import { WalletSchema, paymentMethods } from '../schema';
import { DbTx, PaymentMethod } from '../types';
import { PaymentCustomersService } from '../payment-customers/payment-customers.service';
import { ProviderRegistry } from '../providers/provider.registry';
import { CreatePaymentMethodDto } from './dto';

@Injectable()
export class PaymentMethodsService {
  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly customersService: PaymentCustomersService,
    private readonly providerRegistry: ProviderRegistry,
  ) {}

  async create(dto: CreatePaymentMethodDto): Promise<PaymentMethod> {
    const provider = this.providerRegistry.getProviderOrThrow(dto.type);

    const customer = await this.customersService.upsertByExternalUserId(
      dto.externalUserId,
    );

    await provider.validateMethod({
      customerId: customer.id,
      externalUserId: dto.externalUserId,
      type: dto.type,
      providerData: dto.providerData,
    });

    const rows = await this.dbService.db
      .insert(paymentMethods)
      .values({
        customerId: customer.id,
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

  async findAllByExternalUserId(externalUserId: string): Promise<PaymentMethod[]> {
    const customer = await this.customersService.findByExternalUserId(externalUserId);
    if (!customer) return [];

    return this.dbService.db
      .select()
      .from(paymentMethods)
      .where(
        and(
          eq(paymentMethods.customerId, customer.id),
          eq(paymentMethods.isDeleted, false),
        ),
      );
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
    const customer = await this.customersService.findById(method.customerId);

    await provider.deleteMethod({
      customerId: method.customerId,
      externalUserId: customer?.externalUserId ?? '',
      paymentMethodId: id,
      providerData: method.providerData as Record<string, unknown>,
    });

    await this.dbService.db
      .update(paymentMethods)
      .set({ isDeleted: true, updatedAt: new Date() })
      .where(eq(paymentMethods.id, id));
  }
}
