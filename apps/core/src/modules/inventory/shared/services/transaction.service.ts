import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables, wmsSchema } from '../../schema/inventory.schema';
import { TypedDatabase, DbService } from '@app/db';

@Injectable()
export class TransactionService {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  private get db() {
    return this.dbService.db;
  }

  async runInTransaction<T>(
    callback: (tx: Parameters<Parameters<TypedDatabase<typeof wmsSchema>['transaction']>[0]>[0]) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(callback);
  }
}
