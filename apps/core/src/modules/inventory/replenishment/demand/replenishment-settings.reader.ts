import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx, ReplenishmentSettings } from '../../schema/inventory.schema';

export const SETTINGS_KEY = 'default';

/**
 * 전역 설정 1행 (#743, 스펙 §6). A 는 읽기만 — 쓰기(PUT)는 B 의 규칙 층.
 * 행이 없는 것은 배포 절차(db:seed:ref) 누락이라 도메인 예외가 아니라 Error(500) 다.
 */
@Injectable()
export class ReplenishmentSettingsReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async read(tx?: DbTx): Promise<ReplenishmentSettings> {
    return this.dbService.run(async (trx) => {
      const [row] = await trx
        .select()
        .from(wmsTables.replenishmentSettings)
        .where(eq(wmsTables.replenishmentSettings.key, SETTINGS_KEY));
      if (!row) throw new Error('replenishment_settings 가 비어 있다 — db:seed:ref 를 먼저 돌릴 것');
      return row;
    }, tx);
  }
}
