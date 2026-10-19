import { BadRequestError } from '@app/shared';
import { Injectable } from '@nestjs/common';
import type { IamAuditLogsQueryDto, IamAuditPageDto } from './dto/iam-audit.dto';
import { IamAuditRepository } from './iam-audit.repository';

export function encodeAuditCursor(c: { occurredAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify([c.occurredAt.toISOString(), c.id])).toString('base64url');
}

export function decodeAuditCursor(cursor: string): { occurredAt: Date; id: string } {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    parsed = null;
  }
  if (Array.isArray(parsed) && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') {
    const occurredAt = new Date(parsed[0]);
    if (!Number.isNaN(occurredAt.getTime())) return { occurredAt, id: parsed[1] };
  }
  throw new BadRequestError('잘못된 페이지 커서입니다.');
}

@Injectable()
export class IamAuditReader {
  constructor(private readonly repository: IamAuditRepository) {}

  async page(query: IamAuditLogsQueryDto): Promise<IamAuditPageDto> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const rows = await this.repository.page(
      {
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
        actorUserId: query.actorUserId,
        targetType: query.targetType,
        targetId: query.targetId,
        roleId: query.roleId,
        action: query.action,
        before: query.cursor ? decodeAuditCursor(query.cursor) : undefined,
      },
      limit + 1,
    );
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return { items, nextCursor: rows.length > limit && last ? encodeAuditCursor(last) : null };
  }
}
