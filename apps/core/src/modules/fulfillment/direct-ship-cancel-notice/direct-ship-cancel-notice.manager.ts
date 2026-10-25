import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { BadRequestError } from '@app/shared';
import { and, inArray, isNull } from 'drizzle-orm';
import { wmsSchema, wmsTables, DbTx } from '../../inventory/schema/inventory.schema';

@Injectable()
export class DirectShipCancelNoticeManager {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  /**
   * 고른 행을 «알림 완료»로 표시한다(N28). 되돌리기 없음, 이미 완료된 행은 건너뛴다.
   * 다른 입점사 행이나 없는 id 가 섞이면 아무것도 바꾸지 않고 던진다. 입점사는 id 로만 맞춘다(K3 PR6 N6).
   */
  async markNotified(
    supplierId: string,
    noticeIds: string[],
    notifiedBy: string,
    tx?: DbTx,
  ): Promise<{ notified: number }> {
    return this.dbService.run(async (trx) => {
      const n = wmsTables.directShipCancelNotices;
      const ids = [...new Set(noticeIds)];
      const rows = await trx
        .select({ id: n.id, supplierId: n.supplierId, notifiedAt: n.notifiedAt })
        .from(n)
        .where(inArray(n.id, ids))
        .for('update');
      if (rows.length !== ids.length || rows.some((r) => r.supplierId !== supplierId)) {
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
