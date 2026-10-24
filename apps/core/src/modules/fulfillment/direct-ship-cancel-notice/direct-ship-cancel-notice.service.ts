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

  listOpen(filter: { companyName?: string }): Promise<DirectShipCancelNotice[]> {
    return this.reader.listOpen(filter);
  }

  async exportFile(
    companyName: string,
    noticeIds: string[],
  ): Promise<{ fileName: string; content: Buffer; mimeType: string }> {
    const csv = toCancelNoticeCsv(await this.reader.listOpenSelected(companyName, noticeIds));
    const stamp = formatInTimeZone(new Date(), 'Asia/Seoul', 'yyyyMMddHHmm');
    return {
      fileName: `직배취소알림_${companyName}_${stamp}.csv`,
      content: Buffer.from('﻿' + csv, 'utf8'),
      mimeType: 'text/csv; charset=utf-8',
    };
  }

  markNotified(companyName: string, noticeIds: string[], notifiedBy: string): Promise<{ notified: number }> {
    return this.manager.markNotified(companyName, noticeIds, notifiedBy);
  }
}
