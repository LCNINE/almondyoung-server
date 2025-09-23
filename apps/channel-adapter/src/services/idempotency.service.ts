import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, and } from 'drizzle-orm';
import * as schema from '../schema';
import { NewProcessedEvent, ProcessedEvent } from '../types';

/**
 * 멱등키 기반 이벤트 처리 관리 서비스
 *
 * CTO SoT 원칙에 따라 내부 이벤트의 중복 처리를 방지하고,
 * 재시도 로직과 DLQ 처리를 담당합니다.
 *
 * @example
 * ```typescript
 * // 멱등키 체크
 * const key = 'WMS:STOCK_CHANGED:SKU-001:1695462345000';
 * const isProcessed = await idempotencyService.isProcessed(key);
 *
 * // 처리 완료 마킹
 * await idempotencyService.markProcessed({
 *   idempotencyKey: key,
 *   source: 'WMS',
 *   eventType: 'STOCK_CHANGED',
 *   resourceId: 'SKU-001',
 *   eventVersion: '1695462345000'
 * });
 * ```
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(private readonly db: DbService<typeof schema>) {}

  /**
   * 멱등키 기반 이벤트 처리 여부 확인
   *
   * @param idempotencyKey 멱등키 (SOURCE:EVENT_TYPE:RESOURCE_ID:VERSION)
   * @returns 이미 처리된 이벤트인지 여부
   */
  async isProcessed(idempotencyKey: string): Promise<boolean> {
    try {
      const existing = await this.db.db
        .select()
        .from(schema.processedEvents)
        .where(eq(schema.processedEvents.idempotencyKey, idempotencyKey))
        .limit(1);

      const isProcessed = existing.length > 0;

      if (isProcessed) {
        this.logger.debug(`🔒 이미 처리된 이벤트: ${idempotencyKey}`);
      }

      return isProcessed;
    } catch (error) {
      this.logger.error(
        `❌ 멱등키 체크 실패: ${idempotencyKey}`,
        error.message,
      );
      // 에러 발생 시 안전하게 false 반환 (중복 처리 허용)
      return false;
    }
  }

  /**
   * 이벤트 처리 완료 마킹
   *
   * @param data 처리된 이벤트 정보
   * @returns 생성된 레코드 또는 null (이미 존재하는 경우)
   */
  async markProcessed(data: NewProcessedEvent): Promise<ProcessedEvent | null> {
    try {
      const [inserted] = await this.db.db
        .insert(schema.processedEvents)
        .values({
          ...data,
          status: 'PROCESSED',
          retryCount: 0,
        })
        .onConflictDoNothing() // 중복 시 무시
        .returning();

      if (inserted) {
        this.logger.debug(`✅ 이벤트 처리 완료 마킹: ${data.idempotencyKey}`);
        return inserted;
      } else {
        this.logger.debug(`🔄 이미 마킹된 이벤트: ${data.idempotencyKey}`);
        return null;
      }
    } catch (error) {
      this.logger.error(
        `❌ 이벤트 처리 마킹 실패: ${data.idempotencyKey}`,
        error.message,
      );
      throw new Error(`이벤트 처리 마킹 실패: ${error.message}`);
    }
  }

  /**
   * 이벤트 처리 실패 마킹 (재시도 가능)
   *
   * @param idempotencyKey 멱등키
   * @param errorMessage 에러 메시지
   * @param incrementRetry 재시도 횟수 증가 여부 (기본값: true)
   * @returns 업데이트된 레코드
   */
  async markFailed(
    idempotencyKey: string,
    errorMessage: string,
    incrementRetry: boolean = true,
  ): Promise<ProcessedEvent | null> {
    try {
      const updateData: any = {
        status: 'FAILED',
        errorMessage,
        updatedAt: new Date(),
      };

      if (incrementRetry) {
        updateData.retryCount =
          (
            await this.db.db
              .select({ retryCount: schema.processedEvents.retryCount })
              .from(schema.processedEvents)
              .where(eq(schema.processedEvents.idempotencyKey, idempotencyKey))
              .limit(1)
          )[0]?.retryCount || 0 + 1;
        updateData.lastRetryAt = new Date();
      }

      const [updated] = await this.db.db
        .update(schema.processedEvents)
        .set(updateData)
        .where(eq(schema.processedEvents.idempotencyKey, idempotencyKey))
        .returning();

      if (updated) {
        this.logger.warn(
          `⚠️ 이벤트 처리 실패 마킹: ${idempotencyKey} (재시도: ${updated.retryCount})`,
        );
        return updated;
      } else {
        this.logger.warn(
          `🔍 실패 마킹할 이벤트를 찾을 수 없음: ${idempotencyKey}`,
        );
        return null;
      }
    } catch (error) {
      this.logger.error(
        `❌ 이벤트 실패 마킹 실패: ${idempotencyKey}`,
        error.message,
      );
      throw new Error(`이벤트 실패 마킹 실패: ${error.message}`);
    }
  }

  /**
   * 재시도 중 상태로 마킹
   *
   * @param idempotencyKey 멱등키
   * @returns 업데이트된 레코드
   */
  async markRetrying(idempotencyKey: string): Promise<ProcessedEvent | null> {
    try {
      const [updated] = await this.db.db
        .update(schema.processedEvents)
        .set({
          status: 'RETRYING',
          lastRetryAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.processedEvents.idempotencyKey, idempotencyKey))
        .returning();

      if (updated) {
        this.logger.debug(`🔄 이벤트 재시도 중 마킹: ${idempotencyKey}`);
        return updated;
      } else {
        this.logger.warn(
          `🔍 재시도 마킹할 이벤트를 찾을 수 없음: ${idempotencyKey}`,
        );
        return null;
      }
    } catch (error) {
      this.logger.error(
        `❌ 이벤트 재시도 마킹 실패: ${idempotencyKey}`,
        error.message,
      );
      throw new Error(`이벤트 재시도 마킹 실패: ${error.message}`);
    }
  }

  /**
   * 특정 소스의 처리된 이벤트 조회
   *
   * @param source 이벤트 발행 주체 (WMS, OMS, PIM)
   * @param eventType 이벤트 타입 (STOCK_CHANGED 등)
   * @param resourceId 리소스 ID (SKU, ORDER_ID 등)
   * @param limit 조회 제한 (기본값: 10)
   * @returns 처리된 이벤트 목록
   */
  async getProcessedEvents(
    source: string,
    eventType?: string,
    resourceId?: string,
    limit: number = 10,
  ): Promise<ProcessedEvent[]> {
    try {
      const whereConditions = [eq(schema.processedEvents.source, source)];

      if (eventType) {
        whereConditions.push(eq(schema.processedEvents.eventType, eventType));
      }

      if (resourceId) {
        whereConditions.push(eq(schema.processedEvents.resourceId, resourceId));
      }

      const query = this.db.db
        .select()
        .from(schema.processedEvents)
        .where(and(...whereConditions));

      const results = await query
        .orderBy(schema.processedEvents.createdAt)
        .limit(limit);

      this.logger.debug(
        `🔍 처리된 이벤트 조회: ${source} - ${results.length}건`,
      );
      return results;
    } catch (error) {
      this.logger.error(`❌ 처리된 이벤트 조회 실패: ${source}`, error.message);
      throw new Error(`처리된 이벤트 조회 실패: ${error.message}`);
    }
  }

  /**
   * 실패한 이벤트 중 재시도 대상 조회
   *
   * @param maxRetryCount 최대 재시도 횟수 (기본값: 3)
   * @param limit 조회 제한 (기본값: 100)
   * @returns 재시도 대상 이벤트 목록
   */
  async getRetryableEvents(
    maxRetryCount: number = 3,
    limit: number = 100,
  ): Promise<ProcessedEvent[]> {
    try {
      const results = await this.db.db
        .select()
        .from(schema.processedEvents)
        .where(
          and(
            eq(schema.processedEvents.status, 'FAILED'),
            // retryCount < maxRetryCount 조건 추가 필요 (Drizzle ORM syntax)
          ),
        )
        .orderBy(schema.processedEvents.lastRetryAt)
        .limit(limit);

      this.logger.debug(`🔄 재시도 대상 이벤트 조회: ${results.length}건`);
      return results;
    } catch (error) {
      this.logger.error(`❌ 재시도 대상 이벤트 조회 실패`, error.message);
      throw new Error(`재시도 대상 이벤트 조회 실패: ${error.message}`);
    }
  }

  /**
   * 멱등키 생성 유틸리티
   *
   * @param source 이벤트 발행 주체
   * @param eventType 이벤트 타입
   * @param resourceId 리소스 ID
   * @param eventVersion 이벤트 버전
   * @returns 생성된 멱등키
   */
  static generateIdempotencyKey(
    source: string,
    eventType: string,
    resourceId: string,
    eventVersion: string | number,
  ): string {
    return `${source}:${eventType}:${resourceId}:${eventVersion}`;
  }

  /**
   * 멱등키에서 정보 추출
   *
   * @param idempotencyKey 멱등키
   * @returns 추출된 정보 객체
   */
  static parseIdempotencyKey(idempotencyKey: string): {
    source: string;
    eventType: string;
    resourceId: string;
    eventVersion: string;
  } | null {
    const parts = idempotencyKey.split(':');
    if (parts.length !== 4) {
      return null;
    }

    return {
      source: parts[0],
      eventType: parts[1],
      resourceId: parts[2],
      eventVersion: parts[3],
    };
  }
}
