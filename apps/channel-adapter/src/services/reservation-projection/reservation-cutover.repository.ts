import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { channelAdapterSchema, reservationProjectionSettings } from '../../schema';

const SINGLETON_ID = 'singleton';

/**
 * Medusa 예약 투영의 전환 시각 T (#1247). 비어 있으면(null) 이벤트 소비·대사 모두 아무 것도 쓰지 않는다.
 * 행은 하나뿐(`id = 'singleton'`)이며 쓰기는 `scripts/set-reservation-cutover.ts` 만 한다.
 */
@Injectable()
export class ReservationCutoverRepository {
  constructor(private readonly dbService: DbService<typeof channelAdapterSchema>) {}

  async get(): Promise<Date | null> {
    const [row] = await this.dbService.db
      .select({ cutoverAt: reservationProjectionSettings.cutoverAt })
      .from(reservationProjectionSettings)
      .where(eq(reservationProjectionSettings.id, SINGLETON_ID))
      .limit(1);
    return row?.cutoverAt ?? null;
  }

  async set(at: Date | null, by: string): Promise<void> {
    const updatedAt = new Date();
    await this.dbService.db
      .insert(reservationProjectionSettings)
      .values({ id: SINGLETON_ID, cutoverAt: at, updatedAt, updatedBy: by })
      .onConflictDoUpdate({
        target: reservationProjectionSettings.id,
        set: { cutoverAt: at, updatedAt, updatedBy: by },
      });
  }
}
