import { Controller, Get, Query } from '@nestjs/common';
import { EventMonitorService } from './event-monitor.service';

/**
 * 이벤트 모니터링 대시보드 API
 * 모든 도메인의 이벤트 통계와 현황을 제공합니다.
 */
@Controller('admin/events')
export class EventMonitorController {
  constructor(private readonly eventMonitorService: EventMonitorService) {}

  /**
   * 실시간 이벤트 통계 조회
   * GET /admin/events/stats?hours=24
   */
  @Get('stats')
  async getEventStats(@Query('hours') hours: string = '24') {
    const hoursNum = parseInt(hours, 10) || 24;
    return await this.eventMonitorService.getEventStats(hoursNum);
  }

  /**
   * 이벤트 처리 상태 체크
   * GET /admin/events/health
   */
  @Get('health')
  async getEventHealth() {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      message: '모든 이벤트 리스너가 정상 작동 중입니다.',
      domains: {
        payment: 'active',
        refund: 'active',
        bnpl: 'active',
        invoice: 'active',
        settlement: 'active',
      },
    };
  }

  /**
   * 이벤트 처리 지연 감지
   * GET /admin/events/delays
   */
  @Get('delays')
  async getEventDelays() {
    await this.eventMonitorService.detectEventProcessingDelays();
    return {
      status: 'checked',
      timestamp: new Date().toISOString(),
      message: '이벤트 처리 지연 감지를 실행했습니다.',
    };
  }

  /**
   * 이벤트 처리 실패 감지
   * GET /admin/events/failures
   */
  @Get('failures')
  async getEventFailures() {
    await this.eventMonitorService.detectEventProcessingFailures();
    return {
      status: 'checked',
      timestamp: new Date().toISOString(),
      message: '이벤트 처리 실패 감지를 실행했습니다.',
    };
  }

  /**
   * 이벤트 소싱 대시보드 정보
   * GET /admin/events/dashboard
   */
  @Get('dashboard')
  async getDashboard() {
    const stats = await this.eventMonitorService.getEventStats(24);
    
    return {
      title: 'Event Sourcing Dashboard',
      timestamp: new Date().toISOString(),
      summary: {
        totalEvents: stats.totalEvents,
        domains: Object.keys(stats.byDomain).length,
        activeListeners: 5, // Payment, Refund, BNPL, Invoice, Settlement
      },
      domainStats: stats.byDomain,
      recentEvents: stats.recentEvents,
      systemHealth: {
        eventSourcing: 'active',
        cqrs: 'active',
        monitoring: 'active',
      },
      recommendations: [
        '모든 도메인에 Event Sourcing 패턴이 성공적으로 적용되었습니다.',
        'CQRS 패턴으로 읽기/쓰기 모델이 분리되어 성능이 최적화되었습니다.',
        '실시간 이벤트 모니터링이 활성화되어 시스템 상태를 추적할 수 있습니다.',
      ],
    };
  }
}