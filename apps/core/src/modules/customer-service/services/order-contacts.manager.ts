import { Injectable } from '@nestjs/common';
import { DbService, InjectDb, TxFor } from '@app/db';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { eq, sql } from 'drizzle-orm';
import { type MergedSchema } from '../../../platform/database/merged-schema';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { kstDateOf } from '../../inventory/replenishment/demand/calendar';
import { CreateOrderContactDto } from '../dto/order-contact.dto';
import { salesOrderContacts, type SalesOrderContact } from '../schema/customer-service.schema';

type CsTx = TxFor<MergedSchema>;

@Injectable()
export class OrderContactsManager {
  constructor(@InjectDb() private readonly dbService: DbService<MergedSchema>) {}

  create(dto: CreateOrderContactDto, authorId: string, now: Date, tx?: CsTx): Promise<SalesOrderContact> {
    const values = {
      id: dto.id,
      salesOrderId: dto.salesOrderId,
      outcome: dto.outcome,
      body: dto.body?.trim() ?? '',
      followUpOn: dto.followUpOn ?? null,
      authorId,
    };
    return this.dbService.run(async (trx) => {
      const existing = await this.find(trx, dto.id);
      if (existing) return this.sameRequest(existing, values);

      const [order] = await trx
        .select({ id: wmsTables.salesOrders.id })
        .from(wmsTables.salesOrders)
        .where(eq(wmsTables.salesOrders.id, dto.salesOrderId))
        .limit(1);
      if (!order) throw new NotFoundError(`Sales order not found: ${dto.salesOrderId}`);
      if (values.followUpOn !== null) this.assertFollowUp(values.followUpOn, now);

      const [created] = await trx
        .insert(salesOrderContacts)
        .values({ ...values, createdAt: sql`clock_timestamp()` })
        .onConflictDoNothing()
        .returning();
      if (created) return created;
      // 같은 요청이 동시에 와서 먼저 들어간 행이 있다
      const raced = await this.find(trx, dto.id);
      if (!raced) throw new Error(`Order contact ${dto.id} vanished after conflict`);
      return this.sameRequest(raced, values);
    }, tx);
  }

  private async find(tx: CsTx, id: string): Promise<SalesOrderContact | undefined> {
    const [row] = await tx.select().from(salesOrderContacts).where(eq(salesOrderContacts.id, id)).limit(1);
    return row;
  }

  private sameRequest(
    row: SalesOrderContact,
    values: Pick<SalesOrderContact, 'salesOrderId' | 'outcome' | 'body' | 'followUpOn' | 'authorId'>,
  ): SalesOrderContact {
    const same =
      row.salesOrderId === values.salesOrderId &&
      row.outcome === values.outcome &&
      row.body === values.body &&
      row.followUpOn === values.followUpOn &&
      row.authorId === values.authorId;
    if (!same) throw new ConflictError('이미 다른 내용으로 저장된 요청입니다. 새로 적어 저장해 주세요.');
    return row;
  }

  private assertFollowUp(day: string, now: Date): void {
    const parsed = new Date(`${day}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
      throw new BadRequestError('다시 연락할 날이 달력에 없는 날입니다.');
    }
    if (day < kstDateOf(now)) throw new BadRequestError('다시 연락할 날은 오늘이나 그 뒤여야 합니다.');
  }
}
