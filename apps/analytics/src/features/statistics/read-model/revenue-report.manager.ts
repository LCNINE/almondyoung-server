import { Injectable } from '@nestjs/common';
import { BadRequestError } from '@app/shared';
import type { ExternalRevenueRowDto } from '../api/revenue-report.controller';
import { RevenueReportRepository } from './revenue-report.repository';

@Injectable()
export class RevenueReportManager {
  constructor(private readonly repository: RevenueReportRepository) {}
  import(input: ExternalRevenueRowDto[], recordedBy?: string, batchId?: string) {
    const rows = input.map((row) => ({
      channel: row.channel,
      month: row.month,
      basis: row.basis,
      amount: row.amount,
      expectedUpdatedAt: row.expectedUpdatedAt,
      account: row.account.trim(),
      source: row.source.trim(),
      originalStatus: row.originalStatus ?? 'pending',
      monthlyStatus: row.monthlyStatus ?? 'pending',
      duplicateStatus: row.duplicateStatus ?? 'pending',
      settlementStatus: row.settlementStatus ?? 'pending',
      reviewNote: row.reviewNote?.trim() ?? '',
    }));
    if (new Set(rows.map((row) => row.month.slice(0, 4))).size !== 1)
      throw new BadRequestError('연도별로 나누어 등록해 주세요.');

    const keys = new Set<string>();

    for (const row of rows) {
      const key = JSON.stringify([row.channel, row.account, row.month, row.basis]);

      if (!row.account || !row.source || keys.has(key)) {
        throw new BadRequestError('계정·출처를 입력하고 같은 채널·계정·월·기준의 중복 행을 제거해 주세요.');
      }

      if (
        [row.originalStatus, row.monthlyStatus, row.duplicateStatus, row.settlementStatus].includes('confirmed') &&
        !row.reviewNote?.trim()
      ) {
        throw new BadRequestError('확인으로 표시한 항목에는 대조 메모를 입력해 주세요.');
      }
      keys.add(key);
    }

    return this.repository.import(rows, recordedBy, batchId);
  }
}
