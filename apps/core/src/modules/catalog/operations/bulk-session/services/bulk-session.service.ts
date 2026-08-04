import { Injectable } from '@nestjs/common';
import { BulkSessionManager, BulkSessionAcceptInput } from './bulk-session.manager';
import { BulkSessionReader, BulkItemStatus, BulkImageFilter, BulkPublishStatus } from './bulk-session.reader';
import { ConflictFilter } from './bulk-session.conflicts';
import { BulkImageManager, ResolveEntry } from './bulk-image.manager';
import {
  BulkSessionAcceptedDto,
  BulkSessionImageListDto,
  BulkSessionItemDto,
  BulkSessionItemListDto,
  BulkSessionListDto,
  BulkSessionProgressDto,
  PurgeDraftsResultDto,
  ResolveImagesResponseDto,
} from '../dto';

/** 포트. 흐름만 표현하고 검증·DB 는 매니저·리더가 든다. */
@Injectable()
export class BulkSessionService {
  constructor(
    private readonly manager: BulkSessionManager,
    private readonly reader: BulkSessionReader,
    private readonly imageManager: BulkImageManager,
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
    conflict: ConflictFilter | undefined,
    publishStatus: BulkPublishStatus | undefined,
    page: number,
    limit: number,
  ): Promise<BulkSessionItemListDto> {
    return this.reader.getItems(sessionId, userId, status, conflict, publishStatus, page, limit);
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

  getImages(sessionId: string, userId: string, filter: BulkImageFilter): Promise<BulkSessionImageListDto> {
    return this.reader.getImages(sessionId, userId, filter);
  }

  resolveImages(sessionId: string, userId: string, entries: ResolveEntry[]): Promise<ResolveImagesResponseDto> {
    return this.imageManager.resolve(sessionId, userId, entries);
  }

  queuePublish(sessionId: string, userId: string): Promise<BulkSessionProgressDto> {
    return this.manager.queuePublish(sessionId, userId);
  }

  retryDraft(sessionId: string, userId: string): Promise<BulkSessionProgressDto> {
    return this.manager.retryDraft(sessionId, userId);
  }

  excludeItem(sessionId: string, itemId: string, userId: string): Promise<BulkSessionItemDto> {
    return this.manager.excludeItem(sessionId, itemId, userId);
  }

  purgeDrafts(sessionId: string, userId: string): Promise<PurgeDraftsResultDto> {
    return this.manager.purgeDrafts(sessionId, userId);
  }
}
