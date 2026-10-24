import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { BadRequestError } from '@app/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { wmsSchema, wmsTables, DbTx } from '../../inventory/schema/inventory.schema';

@Injectable()
export class DirectShipCancelNoticeManager {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  /**
   * 고른 행을 «알림 완료»로 표시한다(N28). 되돌리기 없음, 이미 완료된 행은 건너뛴다.
   * 다른 업체 행이나 없는 id 가 섞이면 아무것도 바꾸지 않고 던진다.
   */
  async markNotified(
    companyName: string,
    noticeIds: string[],
    notifiedBy: string,
    tx?: DbTx,
  ): Promise<{ notified: number }> {
    return this.dbService.run(async (trx) => {
      const n = wmsTables.directShipCancelNotices;
      const ids = [...new Set(noticeIds)];
      const rows = await trx
        .select({ id: n.id, holderName: wmsTables.holders.name, notifiedAt: n.notifiedAt })
        .from(n)
        .innerJoin(wmsTables.holders, eq(wmsTables.holders.id, n.holderId))
        .where(inArray(n.id, ids))
        .for('update', { of: n });
      if (rows.length !== ids.length || rows.some((r) => r.holderName !== companyName)) {
        throw new BadRequestError('알림 대상이 이 업체의 알릴 취소가 아닙니다.');
      }
      const updated = await trx
        .update(wmsTables.directShipCancelNotices)
        .set({ notifiedAt: new Date(), notifiedBy })
        .where(and(inArray(n.id, ids), isNull(n.notifiedAt)))
        .returning({ id: n.id });
      return { notified: updated.length };
    }, tx);
  }
}
