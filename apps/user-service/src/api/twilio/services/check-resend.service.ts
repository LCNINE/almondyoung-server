import { DbService, InjectDb } from '@app/db';
import { HttpStatus } from '@nestjs/common';
import {
  userServiceSchema,
  UserServiceSchema,
} from 'apps/user-service/database/drizzle/schema';
import { DbTransaction } from 'apps/user-service/src/commons/types';
import { RESEND_COOLDOWN_TIME } from 'apps/user-service/src/constants/check-resend-time';
import { desc, eq } from 'drizzle-orm';
import { TwilioException } from '../exceptions/twilio.exceptions';

export class CheckResendService {
  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
  ) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.dbService.db;
  }

  async checkResend(phoneNumber: string, tx?: DbTransaction) {
    const client = this.getClient(tx);

    const lastRequest = await client
      .select()
      .from(userServiceSchema.phoneVerifications)
      .where(eq(userServiceSchema.phoneVerifications.phoneNumber, phoneNumber))
      .orderBy(desc(userServiceSchema.phoneVerifications.createdAt))
      .limit(1);

    if (lastRequest.length > 0) {
      const cooldownMs = RESEND_COOLDOWN_TIME;

      const timeSinceLastRequest =
        Date.now() - lastRequest[0].createdAt.getTime();

      if (timeSinceLastRequest < cooldownMs) {
        const remainingMinutes = Math.ceil(
          (cooldownMs - timeSinceLastRequest) / 1000 / 60,
        );

        throw new TwilioException({
          message: `${remainingMinutes}분 후에 다시 시도해주세요`,
          errorCode: 'TWILIO_RESEND_EXCEPTION',
          httpStatus: HttpStatus.TOO_MANY_REQUESTS,
        });
      }
    }
  }
}
