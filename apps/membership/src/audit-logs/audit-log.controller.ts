import {
  Controller,
  Get,
  Query,
  Param,
  UseFilters,
  HttpCode,
  HttpStatus,
  Delete,
} from '@nestjs/common';
import { AuditLogService, AuditLogFilter } from './audit-log.service';
import { SubscriptionExceptionFilter } from '../shared/filters/subscription-exception.filter';

/**
 * 감사 로그 컨트롤러
 * 감사 로그 조회 및 관리 API
 */
@Controller('audit-logs')
@UseFilters(SubscriptionExceptionFilter)
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  /**
   * 감사 로그 조회 (필터링 및 페이징 지원)
   */
  @Get()
  async getAuditLogs(
    @Query('eventType') eventType?: string,
    @Query('userId') userId?: string,
    @Query('subscriptionId') subscriptionId?: string,
    @Query('initiatedBy') initiatedBy?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('sortBy') sortBy?: 'createdAt' | 'eventType' | 'userId',
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
    @Query('adminId') adminId?: string, // 관리자 권한 확인용
  ) {
    // TODO: 실제 구현 시 JWT에서 adminId 추출 및 권한 확인

    const filter: AuditLogFilter = {
      eventType,
      userId,
      subscriptionId,
      initiatedBy,
      startDate,
      endDate,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
      sortBy,
      sortOrder,
    };

    return this.auditLogService.getAuditLogs(filter);
  }

  /**
   * 특정 사용자의 감사 로그 조회
   */
  @Get('user/:userId')
  async getUserAuditLogs(
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('adminId') adminId?: string,
  ) {
    // TODO: 실제 구현 시 JWT에서 adminId 추출 및 권한 확인
    // 사용자는 자신의 로그만 조회 가능, 관리자는 모든 사용자 로그 조회 가능

    const limitNum = limit ? parseInt(limit, 10) : 20;
    const offsetNum = offset ? parseInt(offset, 10) : 0;

    const logs = await this.auditLogService.getUserAuditLogs(
      userId,
      limitNum,
      offsetNum,
    );

    return {
      logs,
      userId,
      limit: limitNum,
      offset: offsetNum,
      retrievedAt: new Date().toISOString(),
    };
  }

  /**
   * 특정 구독의 감사 로그 조회
   */
  @Get('subscription/:subscriptionId')
  async getSubscriptionAuditLogs(
    @Param('subscriptionId') subscriptionId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('adminId') adminId?: string,
  ) {
    // TODO: 실제 구현 시 JWT에서 adminId 추출 및 권한 확인

    const limitNum = limit ? parseInt(limit, 10) : 20;
    const offsetNum = offset ? parseInt(offset, 10) : 0;

    const logs = await this.auditLogService.getSubscriptionAuditLogs(
      subscriptionId,
      limitNum,
      offsetNum,
    );

    return {
      logs,
      subscriptionId,
      limit: limitNum,
      offset: offsetNum,
      retrievedAt: new Date().toISOString(),
    };
  }

  /**
   * 이벤트 타입별 통계 조회
   */
  @Get('stats/event-types')
  async getEventTypeStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('adminId') adminId?: string,
  ) {
    // TODO: 실제 구현 시 JWT에서 adminId 추출 및 권한 확인

    const stats = await this.auditLogService.getEventTypeStats(
      startDate,
      endDate,
    );

    return {
      stats,
      period: {
        startDate,
        endDate,
      },
      generatedAt: new Date().toISOString(),
      generatedBy: adminId,
    };
  }

  /**
   * 관리자 액션 로그 조회
   */
  @Get('admin-actions')
  async getAdminActionLogs(
    @Query('adminId') adminId?: string,
    @Query('targetAdminId') targetAdminId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    // TODO: 실제 구현 시 JWT에서 adminId 추출 및 권한 확인

    const limitNum = limit ? parseInt(limit, 10) : 50;
    const offsetNum = offset ? parseInt(offset, 10) : 0;

    const logs = await this.auditLogService.getAdminActionLogs(
      targetAdminId,
      limitNum,
      offsetNum,
    );

    return {
      logs,
      targetAdminId,
      limit: limitNum,
      offset: offsetNum,
      retrievedAt: new Date().toISOString(),
      retrievedBy: adminId,
    };
  }

  /**
   * 감사 로그 검색
   */
  @Get('search')
  async searchAuditLogs(
    @Query('q') searchTerm: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('adminId') adminId?: string,
  ) {
    // TODO: 실제 구현 시 JWT에서 adminId 추출 및 권한 확인

    if (!searchTerm) {
      return {
        logs: [],
        searchTerm: '',
        message: '검색어를 입력해주세요.',
      };
    }

    const limitNum = limit ? parseInt(limit, 10) : 20;
    const offsetNum = offset ? parseInt(offset, 10) : 0;

    const logs = await this.auditLogService.searchAuditLogs(
      searchTerm,
      limitNum,
      offsetNum,
    );

    return {
      logs,
      searchTerm,
      limit: limitNum,
      offset: offsetNum,
      searchedAt: new Date().toISOString(),
      searchedBy: adminId,
    };
  }

  /**
   * 감사 로그 상세 조회
   */
  @Get('detail/:logId')
  async getAuditLogDetail(
    @Param('logId') logId: string,
    @Query('adminId') adminId?: string,
  ) {
    // TODO: 실제 구현 시 JWT에서 adminId 추출 및 권한 확인

    const log = await this.auditLogService.getAuditLogDetail(logId);

    if (!log) {
      return {
        log: null,
        message: '해당 감사 로그를 찾을 수 없습니다.',
        logId,
      };
    }

    return {
      log,
      retrievedAt: new Date().toISOString(),
      retrievedBy: adminId,
    };
  }

  /**
   * 오래된 감사 로그 정리 (관리자 전용)
   */
  @Delete('cleanup')
  @HttpCode(HttpStatus.OK)
  async cleanupOldLogs(
    @Query('retentionDays') retentionDays?: string,
    @Query('adminId') adminId?: string,
  ) {
    // TODO: 실제 구현 시 JWT에서 adminId 추출 및 권한 확인
    // 고급 관리자 권한 필요

    const retentionDaysNum = retentionDays ? parseInt(retentionDays, 10) : 365;

    const deletedCount =
      await this.auditLogService.cleanupOldLogs(retentionDaysNum);

    return {
      success: true,
      message: `${retentionDaysNum}일 이전의 감사 로그가 정리되었습니다.`,
      deletedCount,
      retentionDays: retentionDaysNum,
      cleanedUpAt: new Date().toISOString(),
      cleanedUpBy: adminId,
    };
  }

  /**
   * 감사 로그 대시보드 데이터 조회
   */
  @Get('dashboard')
  async getDashboardData(
    @Query('period') period: 'day' | 'week' | 'month' = 'week',
    @Query('adminId') adminId?: string,
  ) {
    // TODO: 실제 구현 시 JWT에서 adminId 추출 및 권한 확인

    const now = new Date();
    let startDate: string;

    switch (period) {
      case 'day':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
        break;
      case 'week':
        startDate = new Date(
          now.getTime() - 7 * 24 * 60 * 60 * 1000,
        ).toISOString();
        break;
      case 'month':
        startDate = new Date(
          now.getTime() - 30 * 24 * 60 * 60 * 1000,
        ).toISOString();
        break;
      default:
        startDate = new Date(
          now.getTime() - 7 * 24 * 60 * 60 * 1000,
        ).toISOString();
    }

    const endDate = now.toISOString();

    // 이벤트 타입별 통계
    const eventTypeStats = await this.auditLogService.getEventTypeStats(
      startDate,
      endDate,
    );

    // 관리자 액션 로그 (최근 10개)
    const recentAdminActions = await this.auditLogService.getAdminActionLogs(
      undefined,
      10,
      0,
    );

    return {
      period,
      dateRange: {
        startDate,
        endDate,
      },
      eventTypeStats,
      recentAdminActions,
      generatedAt: new Date().toISOString(),
      generatedBy: adminId,
    };
  }
}
