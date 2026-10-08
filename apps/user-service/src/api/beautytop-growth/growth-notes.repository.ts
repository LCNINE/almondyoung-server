import { DbService, InjectDb } from '@app/db';
import { Injectable } from '@nestjs/common';
import {
  beautytopGrowthNotes,
  beautytopSavedShops,
  type UserServiceSchema,
  type UserServiceTx,
} from 'apps/user-service/database/drizzle/schema';
import { and, desc, eq } from 'drizzle-orm';
import { GrowthNoteTargetDto, RecordGrowthNoteDto } from './dto/growth-note.dto';

export const GROWTH_HISTORY_LIMIT = 30;

@Injectable()
export class GrowthNotesRepository {
  constructor(@InjectDb() private readonly dbService: DbService<UserServiceSchema>) {}

  list(userId: string, target: GrowthNoteTargetDto) {
    return this.dbService.db
      .select({
        id: beautytopGrowthNotes.id,
        action: beautytopGrowthNotes.action,
        memo: beautytopGrowthNotes.memo,
        recordedOn: beautytopGrowthNotes.recordedOn,
        createdAt: beautytopGrowthNotes.createdAt,
      })
      .from(beautytopGrowthNotes)
      .where(
        and(
          eq(beautytopGrowthNotes.userId, userId),
          eq(beautytopGrowthNotes.shopKind, target.shopKind),
          eq(beautytopGrowthNotes.shopId, target.shopId),
        ),
      )
      .orderBy(desc(beautytopGrowthNotes.createdAt), desc(beautytopGrowthNotes.id))
      .limit(GROWTH_HISTORY_LIMIT);
  }

  async isMyShop(userId: string, target: GrowthNoteTargetDto, tx: UserServiceTx) {
    const [shop] = await tx
      .select({ id: beautytopSavedShops.id })
      .from(beautytopSavedShops)
      .where(
        and(
          eq(beautytopSavedShops.userId, userId),
          eq(beautytopSavedShops.role, 'MY_SHOP'),
          eq(beautytopSavedShops.shopKind, target.shopKind),
          eq(beautytopSavedShops.shopId, target.shopId),
        ),
      )
      .limit(1)
      .for('share');
    return !!shop;
  }

  async record(userId: string, dto: RecordGrowthNoteDto, tx: UserServiceTx) {
    await tx
      .insert(beautytopGrowthNotes)
      .values({
        userId,
        shopKind: dto.shopKind,
        shopId: dto.shopId,
        action: dto.action,
        memo: dto.memo?.trim() ?? '',
      })
      .onConflictDoNothing();
  }

  async remove(userId: string, target: GrowthNoteTargetDto, id: string) {
    await this.dbService.db
      .delete(beautytopGrowthNotes)
      .where(
        and(
          eq(beautytopGrowthNotes.id, id),
          eq(beautytopGrowthNotes.userId, userId),
          eq(beautytopGrowthNotes.shopKind, target.shopKind),
          eq(beautytopGrowthNotes.shopId, target.shopId),
        ),
      );
  }
}
