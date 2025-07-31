import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import * as schema from '../../shared/schemas/schema';
import { eq, desc, and, gte, lte, SQL } from 'drizzle-orm';
import { ulid } from 'ulid';
import {
  RecordEventDto,
} from '../dto';
import {
  PaymentSessionEvent,
  PaymentSessionEventInsert,
  PaymentSessionEventType,
} from '../types';

@Injectable()
export class PaymentSessionEventService {
  private readonly logger = new Logger(PaymentSessionEventService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
  ) { }

  /**
   * 이벤트를 기록합니다.
   */
  async recordEvent(dto: RecordEventDto): Promise<PaymentSessionEvent> {
    const { paymentSessionId, eventType, eventData } = dto;
    const now = new Date();

    // PaymentSession 존재 여부 확인
    const paymentSession = await this.dbService.db.query.paymentSessions.findFirst({
      where: eq(schema.paymentSessions.id, paymentSessionId),
      columns: { id: true },
    });

    if (!paymentSession) {
      throw new NotFoundException(`PaymentSession not found: ${paymentSessionId}`);
    }

    const insertData: PaymentSessionEventInsert = {
      paymentSessionId,
      eventType,
      eventData: eventData ? JSON.stringify(eventData) : null,
      occurredAt: now,
    };

    const [newEvent] = await this.dbService.db
      .insert(schema.paymentSessionEvents)
      .values(insertData)
      .returning();

    this.logger.log(
      `PaymentSessionEvent recorded: ${eventType} for session ${paymentSessionId}`,
    );

    return newEvent;
  }

  /**
   * PaymentSession의 모든 이벤트 히스토리를 조회합니다.
   */
  async getEventHistory(paymentSessionId: string): Promise<PaymentSessionEvent[]> {
    // PaymentSession 존재 여부 확인
    const paymentSession = await this.dbService.db.query.paymentSessions.findFirst({
      where: eq(schema.paymentSessions.id, paymentSessionId),
      columns: { id: true },
    });

    if (!paymentSession) {
      throw new NotFoundException(`PaymentSession not found: ${paymentSessionId}`);
    }

    const events = await this.dbService.db.query.paymentSessionEvents.findMany({
      where: eq(schema.paymentSessionEvents.paymentSessionId, paymentSessionId),
      orderBy: [desc(schema.paymentSessionEvents.occurredAt)],
    });

    this.logger.log(
      `Retrieved ${events.length} events for PaymentSession ${paymentSessionId}`,
    );

    return events;
  }

  /**
   * 특정 이벤트 타입의 이벤트들을 조회합니다.
   */
  async getEventsByType(eventType: PaymentSessionEventType): Promise<PaymentSessionEvent[]> {
    const events = await this.dbService.db.query.paymentSessionEvents.findMany({
      where: eq(schema.paymentSessionEvents.eventType, eventType),
      orderBy: [desc(schema.paymentSessionEvents.occurredAt)],
    });

    this.logger.log(`Retrieved ${events.length} events of type ${eventType}`);

    return events;
  }

  /**
   * 시간 범위 내의 이벤트들을 조회합니다.
   */
  async getEventsInTimeRange(
    start: Date,
    end: Date,
    paymentSessionId?: string,
  ): Promise<PaymentSessionEvent[]> {
    const conditions: SQL[] = [
      gte(schema.paymentSessionEvents.occurredAt, start),
      lte(schema.paymentSessionEvents.occurredAt, end),
    ];

    if (paymentSessionId) {
      conditions.push(eq(schema.paymentSessionEvents.paymentSessionId, paymentSessionId));
    }

    const whereCondition = conditions.length === 1 ? conditions[0] : and(...conditions);

    const events = await this.dbService.db.query.paymentSessionEvents.findMany({
      where: whereCondition,
      orderBy: [desc(schema.paymentSessionEvents.occurredAt)],
    });

    this.logger.log(
      `Retrieved ${events.length} events between ${start.toISOString()} and ${end.toISOString()}`,
    );

    return events;
  }

  /**
   * PaymentSession의 최근 이벤트를 조회합니다.
   */
  async getLatestEvent(paymentSessionId: string): Promise<PaymentSessionEvent | null> {
    const event = await this.dbService.db.query.paymentSessionEvents.findFirst({
      where: eq(schema.paymentSessionEvents.paymentSessionId, paymentSessionId),
      orderBy: [desc(schema.paymentSessionEvents.occurredAt)],
    });

    return event || null;
  }

  /**
   * 상태 전환 이벤트들만 조회합니다.
   */
  async getStateTransitionEvents(paymentSessionId: string): Promise<PaymentSessionEvent[]> {
    const stateTransitionEventTypes: PaymentSessionEventType[] = [
      'PAYMENT_AUTHORIZED',
      'PAYMENT_CAPTURED',
      'PAYMENT_FAILED',
      'PAYMENT_CANCELLED',
      'REFUND_COMPLETED',
      'SESSION_EXPIRED',
    ];

    const events = await this.dbService.db.query.paymentSessionEvents.findMany({
      where: and(
        eq(schema.paymentSessionEvents.paymentSessionId, paymentSessionId),
        // Drizzle ORM에서 IN 조건을 사용하려면 inArray를 사용해야 하지만,
        // 여기서는 간단하게 여러 OR 조건으로 처리
      ),
      orderBy: [desc(schema.paymentSessionEvents.occurredAt)],
    });

    // 클라이언트 사이드에서 필터링
    const filteredEvents = events.filter(event =>
      stateTransitionEventTypes.includes(event.eventType as PaymentSessionEventType)
    );

    this.logger.log(
      `Retrieved ${filteredEvents.length} state transition events for PaymentSession ${paymentSessionId}`,
    );

    return filteredEvents;
  }

  /**
   * 오류 이벤트들만 조회합니다.
   */
  async getErrorEvents(paymentSessionId?: string): Promise<PaymentSessionEvent[]> {
    const conditions: SQL[] = [
      eq(schema.paymentSessionEvents.eventType, 'PAYMENT_FAILED'),
    ];

    if (paymentSessionId) {
      conditions.push(eq(schema.paymentSessionEvents.paymentSessionId, paymentSessionId));
    }

    const whereCondition = conditions.length === 1 ? conditions[0] : and(...conditions);

    const events = await this.dbService.db.query.paymentSessionEvents.findMany({
      where: whereCondition,
      orderBy: [desc(schema.paymentSessionEvents.occurredAt)],
    });

    this.logger.log(`Retrieved ${events.length} error events`);

    return events;
  }

  /**
   * 이벤트 통계를 조회합니다.
   */
  async getEventStatistics(
    paymentSessionId?: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<Record<string, number>> {
    let whereCondition;

    if (paymentSessionId || startDate || endDate) {
      const conditions: SQL[] = [];

      if (paymentSessionId) {
        conditions.push(eq(schema.paymentSessionEvents.paymentSessionId, paymentSessionId));
      }

      if (startDate) {
        conditions.push(gte(schema.paymentSessionEvents.occurredAt, startDate));
      }

      if (endDate) {
        conditions.push(lte(schema.paymentSessionEvents.occurredAt, endDate));
      }

      whereCondition = conditions.length === 1 ? conditions[0] : and(...conditions);
    }

    const events = await this.dbService.db.query.paymentSessionEvents.findMany({
      where: whereCondition,
      columns: { eventType: true },
    });

    // 이벤트 타입별 카운트
    const statistics = events.reduce((acc, event) => {
      acc[event.eventType] = (acc[event.eventType] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    this.logger.log(`Generated event statistics: ${JSON.stringify(statistics)}`);

    return statistics;
  }

  /**
   * 이벤트 데이터를 파싱하여 반환합니다.
   */
  parseEventData(event: PaymentSessionEvent): Record<string, any> | null {
    if (!event.eventData) {
      return null;
    }

    try {
      return JSON.parse(event.eventData);
    } catch (error) {
      this.logger.warn(`Failed to parse event data for event ${event.id}:`, error);
      return null;
    }
  }

  /**
   * 이벤트가 상태 전환 이벤트인지 확인합니다.
   */
  isStateTransitionEvent(eventType: PaymentSessionEventType): boolean {
    const stateTransitionEvents = [
      'PAYMENT_AUTHORIZED',
      'PAYMENT_CAPTURED',
      'PAYMENT_FAILED',
      'PAYMENT_CANCELLED',
      'REFUND_COMPLETED',
      'SESSION_EXPIRED',
    ];
    return stateTransitionEvents.includes(eventType);
  }

  /**
   * 이벤트가 오류 이벤트인지 확인합니다.
   */
  isErrorEvent(eventType: PaymentSessionEventType): boolean {
    return eventType === 'PAYMENT_FAILED';
  }
}