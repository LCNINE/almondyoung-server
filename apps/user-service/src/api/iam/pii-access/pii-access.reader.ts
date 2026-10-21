import { BadRequestError } from '@app/shared';
import { Injectable } from '@nestjs/common';
import { decodeAuditCursor, encodeAuditCursor } from '../audit/iam-audit.reader';
import type {
  PiiAccessLogsQueryDto,
  PiiAccessPageDto,
  PiiAccessReviewDto,
  PiiAccessSummaryDto,
  PiiAccessSummaryQueryDto,
} from './dto/pii-access.dto';
import type { UserServiceTx } from 'apps/user-service/database/drizzle/schema';
import { PiiAccessRepository } from './pii-access.repository';

@Injectable()
export class PiiAccessReader {
  constructor(private readonly repository: PiiAccessRepository) {}

  async page(query: PiiAccessLogsQueryDto, tx?: UserServiceTx): Promise<PiiAccessPageDto> {
    if (query.subjectId && !query.subjectType) throw new BadRequestError('대상 종류(subjectType)를 함께 지정하세요.');
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const rows = await this.repository.page(
      {
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
        actorUserId: query.actorUserId,
        action: query.action,
        subject: query.subjectType && query.subjectId ? { type: query.subjectType, id: query.subjectId } : undefined,
        before: query.cursor ? decodeAuditCursor(query.cursor) : undefined,
      },
      limit + 1,
      tx,
    );
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return { items, nextCursor: rows.length > limit && last ? encodeAuditCursor(last) : null };
  }

  async summary(query: PiiAccessSummaryQueryDto): Promise<PiiAccessSummaryDto> {
    const actors = await this.repository.summary(new Date(query.from), new Date(query.to));
    return { from: query.from, to: query.to, actors };
  }

  reviews(): Promise<PiiAccessReviewDto[]> {
    return this.repository.pageReviews(100);
  }
}
