import { Injectable } from '@nestjs/common';
import { DbService, InjectDb, TxFor } from '@app/db';
import { desc, eq } from 'drizzle-orm';
import { type MergedSchema } from '../../../platform/database/merged-schema';
import { salesOrderContacts, type SalesOrderContact } from '../schema/customer-service.schema';

type CsTx = TxFor<MergedSchema>;

@Injectable()
export class OrderContactsReader {
  constructor(@InjectDb() private readonly dbService: DbService<MergedSchema>) {}

  list(salesOrderId: string, tx?: CsTx): Promise<SalesOrderContact[]> {
    return this.dbService.run(
      (trx) =>
        trx
          .select()
          .from(salesOrderContacts)
          .where(eq(salesOrderContacts.salesOrderId, salesOrderId))
          .orderBy(desc(salesOrderContacts.createdAt), desc(salesOrderContacts.id)),
      tx,
    );
  }
}
