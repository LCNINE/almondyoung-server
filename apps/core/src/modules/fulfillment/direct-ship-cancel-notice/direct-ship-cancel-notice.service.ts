import { Injectable } from '@nestjs/common';
import { formatInTimeZone } from 'date-fns-tz';
import { DirectShipCancelNoticeReader } from './direct-ship-cancel-notice.reader';
import { DirectShipCancelNoticeManager } from './direct-ship-cancel-notice.manager';
import { toCancelNoticeCsv } from './direct-ship-cancel-notice-csv';
import { DirectShipCancelNotice } from './direct-ship-cancel-notice.types';

@Injectable()
export class DirectShipCancelNoticeService {
  constructor(
    private readonly reader: DirectShipCancelNoticeReader,
    private readonly manager: DirectShipCancelNoticeManager,
  ) {}

  listOpen(filter: { supplierId?: string }): Promise<DirectShipCancelNotice[]> {
    return this.reader.listOpen(filter);
  }

  async exportFile(
    supplierId: string,
    noticeIds: string[],
  ): Promise<{ fileName: string; content: Buffer; mimeType: string }> {
    const rows = await this.reader.listOpenSelected(supplierId, noticeIds);
    const csv = toCancelNoticeCsv(rows);
    const stamp = formatInTimeZone(new Date(), 'Asia/Seoul', 'yyyyMMddHHmm');
    // 고른 행이 없으면 reader 가 이미 던졌다 — 이름은 행의 입점사 이름
    return {
      fileName: `직배취소알림_${rows[0].companyName}_${stamp}.csv`,
      content: Buffer.from('﻿' + csv, 'utf8'),
      mimeType: 'text/csv; charset=utf-8',
    };
  }

  markNotified(supplierId: string, noticeIds: string[], notifiedBy: string): Promise<{ notified: number }> {
    return this.manager.markNotified(supplierId, noticeIds, notifiedBy);
  }
}
