import { Injectable } from '@nestjs/common';
import { BulkSessionManager, BulkSessionAcceptInput } from './bulk-session.manager';
import { BulkSessionReader, BulkItemStatus } from './bulk-session.reader';
import {
  BulkSessionAcceptedDto,
  BulkSessionItemDto,
  BulkSessionItemListDto,
  BulkSessionListDto,
  BulkSessionProgressDto,
} from '../dto';

/** 포트. 흐름만 표현하고 검증·DB 는 매니저·리더가 든다. */
@Injectable()
export class BulkSessionService {
  constructor(
    private readonly manager: BulkSessionManager,
    private readonly reader: BulkSessionReader,
  ) {}

  upload(input: BulkSessionAcceptInput): Promise<BulkSessionAcceptedDto> {
    return this.manager.accept(input);
  }

  listSessions(userId: string, page: number, limit: number): Promise<BulkSessionListDto> {
    return this.reader.getSessions(userId, page, limit);
  }

  getProgress(sessionId: string, userId: string): Promise<BulkSessionProgressDto> {
    return this.reader.getProgress(sessionId, userId);
  }

  getItems(
    sessionId: string,
    userId: string,
    status: BulkItemStatus | undefined,
    page: number,
    limit: number,
  ): Promise<BulkSessionItemListDto> {
    return this.reader.getItems(sessionId, userId, status, page, limit);
  }

  setConflictDecision(
    sessionId: string,
    itemId: string,
    userId: string,
    decisions: Record<string, string>,
  ): Promise<BulkSessionItemDto> {
    return this.manager.setConflictDecision(sessionId, itemId, userId, decisions);
  }

  approve(sessionId: string, userId: string): Promise<BulkSessionProgressDto> {
    return this.manager.approve(sessionId, userId);
  }

  cancel(sessionId: string, userId: string): Promise<BulkSessionProgressDto> {
    return this.manager.cancel(sessionId, userId);
  }
}
