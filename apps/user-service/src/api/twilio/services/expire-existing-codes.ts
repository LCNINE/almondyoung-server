import { DbService, InjectDb } from '@app/db';
import {
  userServiceSchema,
  UserServiceSchema,
} from 'apps/user-service/database/drizzle/schema';
import { DbTransaction } from 'apps/user-service/src/commons/types';
import { eq } from 'drizzle-orm';

export class ExpireExistingCodesService {
  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
  ) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.dbService.db;
  }

  async expireExistingCodes(phoneNumber: string, tx?: DbTransaction) {
    const client = this.getClient(tx);

    await client
      .update(userServiceSchema.phoneVerifications)
      .set({
        isExpired: true,
      })
      .where(eq(userServiceSchema.phoneVerifications.phoneNumber, phoneNumber));
  }
}
