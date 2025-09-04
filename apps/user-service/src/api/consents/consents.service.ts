import { DbService, InjectDb } from '@app/db';
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbTransaction } from '../../commons/types';
import { CreateConsentDto } from './dto/consent-dto';
import {
  userConsents,
  type UserServiceSchema,
} from 'apps/user-service/database/drizzle/schema';
import { UserConsent } from './types/consent.type';
import { ConsentsNotFoundException } from './exceptions/consents.exceptions';

@Injectable()
export class ConsentsService {
  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
  ) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.dbService.db;
  }

  async getUserConsent(
    userId: string,
    tx?: DbTransaction,
  ): Promise<UserConsent | null> {
    const db = this.getClient(tx);
    const [consents] = await db
      .select()
      .from(userConsents)
      .where(eq(userConsents.userId, userId));

    if (!consents) {
      throw new ConsentsNotFoundException('User consent not found');
    }
    return consents;
  }

  async createConsent(
    userId: string,
    createConsentDto: CreateConsentDto,
    tx?: DbTransaction,
  ): Promise<void> {
    const db = this.getClient(tx);

    await db.insert(userConsents).values({
      userId,
      ...createConsentDto,
    });
  }
}
