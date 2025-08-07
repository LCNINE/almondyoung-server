import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, and, gte, lte, desc, asc } from 'drizzle-orm';
import * as schema from '../shared/schemas/entities/schema';

export interface AuditLogEntry {
  id: string;
  eventType: string;
  userId: string;
  subscriptionId: string | null;
  effectiveDate: string;
  eventPayload: any;
  initiatedBy: string | null;
  createdAt: Date;
}

export interface AuditLogFilter {
  eventType?: string;
  userId?: string;
  subscriptionId?: string;
  initiatedBy?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'createdAt' | 'eventType' | 'userId';
  sortOrder?: 'asc' | 'desc';
}

export interface AuditLogResponse {
  logs: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

@Injectable()
export class AuditLogService {
  constructor(private readonly dbService: DbService<typeof schema>) {}

  /**
   * 감사 로그 조회 (필터링 및 페이징 지원)
   */
  async getAuditLogs(filter: AuditLogFilter = {}): Promise<AuditLogResponse> {
    const {
      eventType,
      userId,
      subscriptionId,
      initiatedBy,
      startDate,
      endDate,
      limit = 50,
      offset = 0,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = filter;

    // 조건 구성
    const conditions: any[] = [];

    if (eventType) {
      conditions.push(eq(schema.subscriptionEvents.eventType, eventType));
    }

    if (userId) {
      conditions.push(eq(schema.subscriptionEvents.userId, userId));
    }

    if (subscriptionId) {
      conditions.push(
        eq(schema.subscriptionEvents.subscriptionId, subscriptionId),
      );
    }

    if (initiatedBy) {
      conditions.push(eq(schema.subscriptionEvents.initiatedBy, initiatedBy));
    }

    if (startDate) {
      conditions.push(
        gte(schema.subscriptionEvents.createdAt, new Date(startDate)),
      );
    }

    if (endDate) {
      conditions.push(
        lte(schema.subscriptionEvents.createdAt, new Date(endDate)),
      );
    }

    // 정렬 조건
    const orderBy =
      sortOrder === 'asc'
        ? asc(schema.subscriptionEvents[sortBy])
        : desc(schema.subscriptionEvents[sortBy]);

    // 전체 개수 조회
    let totalQuery = this.dbService.db
      .select({ count: schema.subscriptionEvents.id })
      .from(schema.subscriptionEvents);

    if (conditions.length > 0) {
      totalQuery = totalQuery.where(and(...conditions)) as any;
    }

    const totalResult = await totalQuery;
    const total = totalResult.length;

    // 데이터 조회
    let dataQuery = this.dbService.db.select().from(schema.subscriptionEvents);

    if (conditions.length > 0) {
      dataQuery = dataQuery.where(and(...conditions)) as any;
    }

    const logs = await dataQuery.orderBy(orderBy).limit(limit).offset(offset);

    // 페이징 정보 계산
    const page = Math.floor(offset / limit) + 1;
    const pageSize = limit;
    const hasNext = offset + limit < total;
    const hasPrevious = offset > 0;

    return {
      logs: logs.map((log) => ({
        id: log.id,
        eventType: log.eventType,
        userId: log.userId,
        subscriptionId: log.subscriptionId,
        effectiveDate: log.effectiveDate,
        eventPayload: log.eventPayload,
        initiatedBy: log.initiatedBy,
        createdAt: log.createdAt,
      })),
      total,
      page,
      pageSize,
      hasNext,
      hasPrevious,
    };
  }

  /**
   * 특정 사용자의 감사 로그 조회
   */
  async getUserAuditLogs(
    userId: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<AuditLogEntry[]> {
    const logs = await this.dbService.db
      .select()
      .from(schema.subscriptionEvents)
      .where(eq(schema.subscriptionEvents.userId, userId))
      .orderBy(desc(schema.subscriptionEvents.createdAt))
      .limit(limit)
      .offset(offset);

    return logs.map((log) => ({
      id: log.id,
      eventType: log.eventType,
      userId: log.userId,
      subscriptionId: log.subscriptionId,
      effectiveDate: log.effectiveDate,
      eventPayload: log.eventPayload,
      initiatedBy: log.initiatedBy,
      createdAt: log.createdAt,
    }));
  }

  /**
   * 특정 구독의 감사 로그 조회
   */
  async getSubscriptionAuditLogs(
    subscriptionId: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<AuditLogEntry[]> {
    const logs = await this.dbService.db
      .select()
      .from(schema.subscriptionEvents)
      .where(eq(schema.subscriptionEvents.subscriptionId, subscriptionId))
      .orderBy(desc(schema.subscriptionEvents.createdAt))
      .limit(limit)
      .offset(offset);

    return logs.map((log) => ({
      id: log.id,
      eventType: log.eventType,
      userId: log.userId,
      subscriptionId: log.subscriptionId,
      effectiveDate: log.effectiveDate,
      eventPayload: log.eventPayload,
      initiatedBy: log.initiatedBy,
      createdAt: log.createdAt,
    }));
  }

  /**
   * 이벤트 타입별 통계 조회
   */
  async getEventTypeStats(
    startDate?: string,
    endDate?: string,
  ): Promise<{ eventType: string; count: number }[]> {
    const conditions: any[] = [];

    if (startDate) {
      conditions.push(
        gte(schema.subscriptionEvents.createdAt, new Date(startDate)),
      );
    }

    if (endDate) {
      conditions.push(
        lte(schema.subscriptionEvents.createdAt, new Date(endDate)),
      );
    }

    const results = await this.dbService.db
      .select({
        eventType: schema.subscriptionEvents.eventType,
        count: schema.subscriptionEvents.id,
      })
      .from(schema.subscriptionEvents)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    // 이벤트 타입별로 그룹화하여 카운트
    const statsMap = new Map<string, number>();
    results.forEach((result) => {
      const count = statsMap.get(result.eventType) || 0;
      statsMap.set(result.eventType, count + 1);
    });

    return Array.from(statsMap.entries())
      .map(([eventType, count]) => ({
        eventType,
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * 관리자 액션 로그 조회
   */
  async getAdminActionLogs(
    adminId?: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<AuditLogEntry[]> {
    const conditions: any[] = [];

    // 관리자 액션 이벤트 타입들
    const adminEventTypes = [
      'TIER_CREATED',
      'TIER_UPDATED',
      'TIER_DELETED',
      'PLAN_CREATED',
      'PLAN_UPDATED',
      'PLAN_DEACTIVATED',
      'USER_RIGHTS_TERMINATED',
      'USER_RIGHTS_EXTENDED',
      'SUBSCRIPTION_FORCE_CHANGED',
      'PAUSE_QUOTA_RESET',
      'CREDIT_GRANTED',
    ];

    if (adminId) {
      conditions.push(eq(schema.subscriptionEvents.initiatedBy, adminId));
    }

    const logs = await this.dbService.db
      .select()
      .from(schema.subscriptionEvents)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.subscriptionEvents.createdAt))
      .limit(limit)
      .offset(offset);

    // 관리자 이벤트만 필터링
    const filteredLogs = logs.filter((log) =>
      adminEventTypes.includes(log.eventType),
    );

    return filteredLogs.map((log) => ({
      id: log.id,
      eventType: log.eventType,
      userId: log.userId,
      subscriptionId: log.subscriptionId,
      effectiveDate: log.effectiveDate,
      eventPayload: log.eventPayload,
      initiatedBy: log.initiatedBy,
      createdAt: log.createdAt,
    }));
  }

  /**
   * 감사 로그 검색 (이벤트 페이로드 내용 검색)
   */
  async searchAuditLogs(
    searchTerm: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<AuditLogEntry[]> {
    // 모든 로그를 가져온 후 클라이언트 사이드에서 필터링
    // TODO: 실제 구현에서는 DB 레벨에서 처리하는 것이 좋음 (PostgreSQL ILIKE 사용)
    const logs = await this.dbService.db
      .select()
      .from(schema.subscriptionEvents)
      .orderBy(desc(schema.subscriptionEvents.createdAt))
      .limit(limit * 2) // 필터링을 고려해 더 많이 가져옴
      .offset(offset);

    // 클라이언트 사이드에서 필터링
    const filteredLogs = logs
      .filter(
        (log) =>
          log.eventType.toLowerCase().includes(searchTerm.toLowerCase()) ||
          log.userId.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (log.subscriptionId &&
            log.subscriptionId
              .toLowerCase()
              .includes(searchTerm.toLowerCase())) ||
          JSON.stringify(log.eventPayload)
            .toLowerCase()
            .includes(searchTerm.toLowerCase()),
      )
      .slice(0, limit);

    return filteredLogs.map((log) => ({
      id: log.id,
      eventType: log.eventType,
      userId: log.userId,
      subscriptionId: log.subscriptionId,
      effectiveDate: log.effectiveDate,
      eventPayload: log.eventPayload,
      initiatedBy: log.initiatedBy,
      createdAt: log.createdAt,
    }));
  }

  /**
   * 감사 로그 상세 조회
   */
  async getAuditLogDetail(logId: string): Promise<AuditLogEntry | null> {
    const log = await this.dbService.db
      .select()
      .from(schema.subscriptionEvents)
      .where(eq(schema.subscriptionEvents.id, logId))
      .limit(1);

    if (!log.length) {
      return null;
    }

    const logEntry = log[0];
    return {
      id: logEntry.id,
      eventType: logEntry.eventType,
      userId: logEntry.userId,
      subscriptionId: logEntry.subscriptionId,
      effectiveDate: logEntry.effectiveDate,
      eventPayload: logEntry.eventPayload,
      initiatedBy: logEntry.initiatedBy,
      createdAt: logEntry.createdAt,
    };
  }

  /**
   * 감사 로그 보존 정책 적용 (오래된 로그 삭제)
   */
  async cleanupOldLogs(retentionDays: number = 365): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const deletedLogs = await this.dbService.db
      .delete(schema.subscriptionEvents)
      .where(lte(schema.subscriptionEvents.createdAt, cutoffDate));

    // 실제 삭제된 로그 수를 반환하려면 별도 쿼리가 필요
    // 여기서는 간단히 0을 반환
    return 0;
  }
}
