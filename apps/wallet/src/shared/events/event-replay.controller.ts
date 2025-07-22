import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { EventReplayService } from './event-replay.service';

/**
 * 이벤트 재생 API
 * Event Sourcing의 핵심 기능인 이벤트 재생을 제공합니다.
 */
@Controller('admin/events/replay')
export class EventReplayController {
  constructor(private readonly eventReplayService: EventReplayService) {}

  /**
   * Invoice 이벤트 재생
   * POST /admin/events/replay/invoice/:invoiceId
   */
  @Post('invoice/:invoiceId')
  async replayInvoiceEvents(
    @Param('invoiceId') invoiceId: string,
    @Body() body: { targetDate?: string }
  ) {
    const targetDate = body.targetDate ? new Date(body.targetDate) : undefined;
    return await this.eventReplayService.replayInvoiceEvents(invoiceId, targetDate);
  }

  /**
   * Payment 이벤트 재생
   * POST /admin/events/replay/payment/:paymentEventId
   */
  @Post('payment/:paymentEventId')
  async replayPaymentEvents(
    @Param('paymentEventId') paymentEventId: string,
    @Body() body: { targetDate?: string }
  ) {
    const targetDate = body.targetDate ? new Date(body.targetDate) : undefined;
    return await this.eventReplayService.replayPaymentEvents(paymentEventId, targetDate);
  }

  /**
   * 기간별 이벤트 재생
   * POST /admin/events/replay/date-range
   */
  @Post('date-range')
  async replayEventsByDateRange(
    @Body() body: {
      startDate: string;
      endDate: string;
      domain?: 'INVOICE' | 'PAYMENT' | 'REFUND' | 'BNPL' | 'SETTLEMENT';
    }
  ) {
    const startDate = new Date(body.startDate);
    const endDate = new Date(body.endDate);
    
    return await this.eventReplayService.replayEventsByDateRange(
      startDate,
      endDate,
      body.domain
    );
  }

  /**
   * 이벤트 재생 시뮬레이션
   * GET /admin/events/replay/simulate/:invoiceId
   */
  @Get('simulate/:invoiceId')
  async simulateEventReplay(
    @Param('invoiceId') invoiceId: string,
    @Query('dryRun') dryRun: string = 'true'
  ) {
    const isDryRun = dryRun.toLowerCase() === 'true';
    return await this.eventReplayService.simulateEventReplay(invoiceId, isDryRun);
  }

  /**
   * 이벤트 재생 가이드
   * GET /admin/events/replay/guide
   */
  @Get('guide')
  async getReplayGuide() {
    return {
      title: 'Event Replay Guide',
      description: 'Event Sourcing 패턴의 이벤트 재생 기능 사용법',
      endpoints: {
        'POST /admin/events/replay/invoice/:invoiceId': {
          description: '특정 Invoice의 모든 이벤트를 재생합니다.',
          body: {
            targetDate: '2024-01-01T00:00:00Z (선택사항)',
          },
          example: {
            invoiceId: 'inv_123456789',
            targetDate: '2024-01-01T00:00:00Z',
          },
        },
        'POST /admin/events/replay/payment/:paymentEventId': {
          description: '특정 Payment의 이벤트를 재생합니다.',
          body: {
            targetDate: '2024-01-01T00:00:00Z (선택사항)',
          },
        },
        'POST /admin/events/replay/date-range': {
          description: '특정 기간의 모든 이벤트를 재생합니다.',
          body: {
            startDate: '2024-01-01T00:00:00Z',
            endDate: '2024-01-31T23:59:59Z',
            domain: 'INVOICE | PAYMENT | REFUND | BNPL | SETTLEMENT (선택사항)',
          },
        },
        'GET /admin/events/replay/simulate/:invoiceId': {
          description: '이벤트 재생을 시뮬레이션합니다 (실제 변경 없음).',
          query: {
            dryRun: 'true | false (기본값: true)',
          },
        },
      },
      useCases: [
        '데이터 복구: 특정 시점으로 데이터 상태를 되돌리고 싶을 때',
        '디버깅: 특정 Invoice나 Payment의 상태 변화 과정을 추적할 때',
        '감사: 특정 기간의 모든 거래 이벤트를 재검토할 때',
        '테스트: 이벤트 처리 로직을 검증할 때',
      ],
      warnings: [
        '이벤트 재생은 시스템 상태를 변경할 수 있으므로 신중하게 사용하세요.',
        '프로덕션 환경에서는 반드시 시뮬레이션을 먼저 실행하세요.',
        '대량의 이벤트 재생은 시스템 성능에 영향을 줄 수 있습니다.',
      ],
    };
  }
}