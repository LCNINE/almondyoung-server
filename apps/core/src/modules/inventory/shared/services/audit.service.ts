import { Injectable, Logger } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables, wmsSchema, auditEventTypeEnum, auditSeverityEnum, DbTx } from '../../schema/inventory.schema';
import { DbService } from '@app/db';
import { nowSeoul } from './time.util';
import { eq, gte, lte, desc, and } from 'drizzle-orm';

export interface AuditContext {
  userId?: string;
  userAgent?: string;
  ipAddress?: string;
  correlationId?: string;
}

export interface AuditLogData {
  eventType: (typeof auditEventTypeEnum.enumValues)[number];
  severity?: (typeof auditSeverityEnum.enumValues)[number];
  action: string;
  module: string;
  description?: string;

  resourceType?: string;
  resourceId?: string;
  resourceName?: string;

  changesBefore?: Record<string, any>;
  changesAfter?: Record<string, any>;

  metadata?: Record<string, any>;
  errorMessage?: string;
  stackTrace?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  private get db() {
    return this.dbService.db;
  }

  /**
   * 감사 로그 기록 (데이터베이스에 영속화)
   */
  async log(data: AuditLogData, context?: AuditContext, tx?: DbTx): Promise<void> {
    try {
      const db = tx || this.db;

      await db.insert(wmsTables.auditLogs).values({
        eventType: data.eventType,
        severity: data.severity || 'INFO',
        action: data.action,
        module: data.module,
        description: data.description,

        resourceType: data.resourceType,
        resourceId: data.resourceId,
        resourceName: data.resourceName,

        changesBefore: data.changesBefore,
        changesAfter: data.changesAfter,

        metadata: data.metadata,
        errorMessage: data.errorMessage,
        stackTrace: data.stackTrace,

        userId: context?.userId,
        userAgent: context?.userAgent,
        ipAddress: context?.ipAddress,
        correlationId: context?.correlationId,

        timestamp: nowSeoul(),
      });

      // 로컬 로그도 함께 남김
      const logLevel = this.mapSeverityToLogLevel(data.severity || 'INFO');
      this.logger[logLevel](`[AUDIT] ${data.module}.${data.action} - ${data.description || data.eventType}`, {
        eventType: data.eventType,
        resourceType: data.resourceType,
        resourceId: data.resourceId,
        userId: context?.userId,
        correlationId: context?.correlationId,
      });
    } catch (error) {
      // 감사 로그 실패는 시스템을 중단시키지 않음
      this.logger.error('Failed to write audit log:', error, {
        originalData: data,
        context: context,
      });
    }
  }

  /**
   * 사용자 액션 감사 로그
   */
  async logUserAction(
    action: string,
    module: string,
    description: string,
    context?: AuditContext,
    metadata?: Record<string, any>,
    tx?: DbTx,
  ): Promise<void> {
    await this.log(
      {
        eventType: 'USER_ACTION',
        severity: 'INFO',
        action,
        module,
        description,
        metadata,
      },
      context,
      tx,
    );
  }

  /**
   * 리소스 변경 감사 로그
   */
  async logResourceChange(
    eventType: (typeof auditEventTypeEnum.enumValues)[number],
    action: string,
    module: string,
    resourceType: string,
    resourceId: string,
    resourceName: string,
    changesBefore?: Record<string, any>,
    changesAfter?: Record<string, any>,
    context?: AuditContext,
    tx?: DbTx,
  ): Promise<void> {
    await this.log(
      {
        eventType,
        severity: 'INFO',
        action,
        module,
        resourceType,
        resourceId,
        resourceName,
        changesBefore,
        changesAfter,
        description: `${resourceType} ${resourceId} ${action}`,
      },
      context,
      tx,
    );
  }

  /**
   * 에러 감사 로그
   */
  async logError(
    module: string,
    action: string,
    error: Error,
    context?: AuditContext & {
      resourceType?: string;
      resourceId?: string;
      metadata?: Record<string, any>;
    },
    tx?: DbTx,
  ): Promise<void> {
    await this.log(
      {
        eventType: 'SYSTEM_ERROR',
        severity: 'ERROR',
        action,
        module,
        description: `Error in ${module}.${action}: ${error.message}`,
        resourceType: context?.resourceType,
        resourceId: context?.resourceId,
        metadata: context?.metadata,
        errorMessage: error.message,
        stackTrace: error.stack,
      },
      context,
      tx,
    );
  }

  /**
   * 시스템 이벤트 감사 로그
   */
  async logSystemEvent(
    eventType: 'SYSTEM_STARTUP' | 'SYSTEM_ERROR' | 'SYSTEM_WARNING',
    module: string,
    description: string,
    severity: (typeof auditSeverityEnum.enumValues)[number] = 'INFO',
    metadata?: Record<string, any>,
    tx?: DbTx,
  ): Promise<void> {
    await this.log(
      {
        eventType,
        severity,
        action: 'system_event',
        module,
        description,
        metadata,
      },
      undefined,
      tx,
    );
  }

  /**
   * 레거시 호환성을 위한 메소드 (deprecated)
   * @deprecated Use log() method instead
   */
  async logChange(category: string, payload: Record<string, unknown>): Promise<void> {
    this.logger.warn('Using deprecated logChange method. Please use log() method instead.');

    // 콘솔 로그 (기존 방식)
    console.log(`[AUDIT][${category}]`, { ts: nowSeoul().toISOString(), ...payload });

    // 새로운 방식으로도 기록
    await this.log({
      eventType: 'USER_ACTION',
      severity: 'INFO',
      action: 'legacy_log_change',
      module: category,
      description: `Legacy audit log: ${category}`,
      metadata: payload,
    });
  }

  /**
   * 감사 로그 조회
   */
  async queryLogs(params: {
    resourceType?: string;
    resourceId?: string;
    module?: string;
    eventType?: string;
    severity?: string;
    userId?: string;
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
    offset?: number;
  }) {
    const query = this.db.select().from(wmsTables.auditLogs);

    // 필터 조건들
    const conditions: any[] = [];

    if (params.resourceType) {
      conditions.push(eq(wmsTables.auditLogs.resourceType, params.resourceType));
    }
    if (params.resourceId) {
      conditions.push(eq(wmsTables.auditLogs.resourceId, params.resourceId));
    }
    if (params.module) {
      conditions.push(eq(wmsTables.auditLogs.module, params.module));
    }
    if (params.eventType) {
      conditions.push(eq(wmsTables.auditLogs.eventType, params.eventType as any));
    }
    if (params.severity) {
      conditions.push(eq(wmsTables.auditLogs.severity, params.severity as any));
    }
    if (params.userId) {
      conditions.push(eq(wmsTables.auditLogs.userId, params.userId));
    }
    if (params.fromDate) {
      conditions.push(gte(wmsTables.auditLogs.timestamp, params.fromDate));
    }
    if (params.toDate) {
      conditions.push(lte(wmsTables.auditLogs.timestamp, params.toDate));
    }

    // 조건 적용
    const finalQuery = conditions.length > 0 ? query.where(and(...conditions)) : query;

    return finalQuery
      .orderBy(desc(wmsTables.auditLogs.timestamp))
      .limit(params.limit || 100)
      .offset(params.offset || 0);
  }

  /**
   * 심각도를 로그 레벨에 매핑
   */
  private mapSeverityToLogLevel(severity: string): 'log' | 'warn' | 'error' {
    switch (severity) {
      case 'CRITICAL':
      case 'ERROR':
        return 'error';
      case 'WARN':
        return 'warn';
      case 'INFO':
      default:
        return 'log';
    }
  }
}
