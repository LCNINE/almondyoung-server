import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { walletSchema } from '../../shared/database/schema';
import * as schema from '../../shared/database/schema';
import { eq, desc } from 'drizzle-orm';

export interface CreateCmsResponseDto {
  batchId: string;
  accountId: string;
  eventId?: string;
  responseType: string;
  cmsResponseSnapshot: any;
  previousStatus?: string;
  newStatus: string;
  metadata?: any;
}

/**
 * BnplCmsResponseRepository
 *
 * 책임:
 * - CMS 응답 이력 생성 및 조회
 * - 배치/계정/이벤트별 이력 추적
 */
@Injectable()
export class BnplCmsResponseRepository {
  private readonly logger = new Logger(BnplCmsResponseRepository.name);

  constructor(private readonly db: DbService<typeof walletSchema>) {}

  /**
   * CMS 응답을 기록합니다.
   */
  async createResponse(dto: CreateCmsResponseDto, tx?: any): Promise<string> {
    const executor = tx ?? this.db.db;

    const [result] = await executor
      .insert(schema.bnplCmsResponses)
      .values({
        batchId: dto.batchId,
        accountId: dto.accountId,
        eventId: dto.eventId ?? null,
        responseType: dto.responseType,
        cmsResponseSnapshot: JSON.stringify(dto.cmsResponseSnapshot),
        previousStatus: dto.previousStatus ?? null,
        newStatus: dto.newStatus,
        metadata: dto.metadata ? JSON.stringify(dto.metadata) : null,
      })
      .returning({ id: schema.bnplCmsResponses.id });

    this.logger.log(
      `CMS response recorded: ${result.id} for batch ${dto.batchId}`,
    );

    return result.id;
  }

  /**
   * 배치 ID로 모든 응답 이력을 조회합니다.
   */
  async findByBatchId(batchId: string) {
    return this.db.db.query.bnplCmsResponses.findMany({
      where: eq(schema.bnplCmsResponses.batchId, batchId),
      orderBy: [desc(schema.bnplCmsResponses.createdAt)],
    });
  }

  /**
   * 계정 ID로 모든 응답 이력을 조회합니다.
   */
  async findByAccountId(accountId: string) {
    return this.db.db.query.bnplCmsResponses.findMany({
      where: eq(schema.bnplCmsResponses.accountId, accountId),
      orderBy: [desc(schema.bnplCmsResponses.createdAt)],
    });
  }

  /**
   * 이벤트 ID로 응답 이력을 조회합니다.
   */
  async findByEventId(eventId: string) {
    return this.db.db.query.bnplCmsResponses.findMany({
      where: eq(schema.bnplCmsResponses.eventId, eventId),
      orderBy: [desc(schema.bnplCmsResponses.createdAt)],
    });
  }

  /**
   * 배치 ID로 최신 응답을 조회합니다.
   */
  async findLatestByBatchId(batchId: string) {
    return this.db.db.query.bnplCmsResponses.findFirst({
      where: eq(schema.bnplCmsResponses.batchId, batchId),
      orderBy: [desc(schema.bnplCmsResponses.createdAt)],
    });
  }
}
