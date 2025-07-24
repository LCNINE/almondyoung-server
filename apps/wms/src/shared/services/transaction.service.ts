import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../../database/schemas/wms-schema';
import { TypedDatabase, DbService } from '@app/db';

@Injectable()
export class TransactionService {
    constructor(
        @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>,
    ) { }

    private get db() {
        return this.dbService.db;
    }

    async runInTransaction<T>(
        callback: (tx: Parameters<Parameters<TypedDatabase<typeof wmsTables>['transaction']>[0]>[0]) => Promise<T>
    ): Promise<T> {
        return this.db.transaction(callback);
    }
}