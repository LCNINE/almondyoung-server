import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ulid } from 'ulid';
import { eq } from 'drizzle-orm';
import { DbService, InjectDb } from '@app/db';
import * as schema from '../../shared/schemas/schema';
import { EventEmitter2 } from '@nestjs/event-emitter';

// 💡 1. 역할에 맞는, 새롭게 정의된 타입들을 import 합니다.
import {
  PaymentEvent,
  RequestPaymentPayload,
  AuthorizePaymentPayload,
  CapturePaymentPayload,
  FailPaymentPayload,
  // ... (다른 필요한 타입들)
} from '../../shared/zod'; // 실제 경로는 맞게 수정해주세요.

@Injectable()
export class BnplPaymentService {
  private readonly logger = new Logger(BnplPaymentService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
    private eventEmitter: EventEmitter2,
  ) { }

  /**
   * 💡 [생성] 새로운 결제 요청을 받아 'REQUESTED' 상태의 이벤트를 생성합니다.
   * @param payload 결제 요청에 필요한 데이터
   * @returns 생성된 PaymentEvent 객체
   */
  async requestPayment(payload: RequestPaymentPayload): Promise<PaymentEvent> {
    const now = new Date();
    const eventId = ulid();

    // DB 저장용 데이터 변환
    const dbPayload = {
      id: eventId,
      invoiceId: payload.invoiceId,
      paymentMethodId: payload.paymentMethodId,
      amount: payload.amount,
      status: 'REQUESTED' as const,
      actor: payload.actor,
      metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
      pgTransactionId: null,
      pgResponse: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: null, // 생성 시에는 null
    };

    const [createdEvent] = await this.dbService.db
      .insert(schema.paymentEvents)
      .values(dbPayload)
      .returning();

    this.logger.log(`결제 요청 생성됨: ${createdEvent.id}`);
    // this.eventEmitter.emit('payment.requested', createdEvent);
    return createdEvent as PaymentEvent;
  }

  /**
   * 💡 [상태 업데이트] 기존 결제를 'AUTHORIZED' 상태로 변경합니다.
   * @param payload 승인에 필요한 데이터 (업데이트할 이벤트 ID 포함)
   * @returns 업데이트된 PaymentEvent 객체
   */
  async authorizePayment(
    payload: AuthorizePaymentPayload,
  ): Promise<PaymentEvent> {
    const { id, pgTransactionId, pgResponse, actor } = payload;

    const eventToUpdate = await this.findAndValidateState(id, 'REQUESTED');

    const [updatedEvent] = await this.dbService.db
      .update(schema.paymentEvents)
      .set({
        status: 'AUTHORIZED',
        pgTransactionId,
        pgResponse,
        actor,
        updatedAt: new Date(),
      })
      .where(eq(schema.paymentEvents.id, id))
      .returning();

    this.logger.log(`결제 승인됨: ${updatedEvent.id}`);
    // this.eventEmitter.emit('payment.authorized', updatedEvent);
    return updatedEvent as PaymentEvent;
  }

  /**
   * 💡 [상태 업데이트] 기존 결제를 'CAPTURED' 상태로 변경합니다.
   * @param payload 캡처에 필요한 데이터 (업데이트할 이벤트 ID 포함)
   * @returns 업데이트된 PaymentEvent 객체
   */
  async capturePayment(payload: CapturePaymentPayload): Promise<PaymentEvent> {
    const { id, actor } = payload;

    // 캡처는 보통 'AUTHORIZED' 상태의 결제에 대해 이루어집니다.
    const eventToUpdate = await this.findAndValidateState(id, 'AUTHORIZED');

    const [updatedEvent] = await this.dbService.db
      .update(schema.paymentEvents)
      .set({
        status: 'CAPTURED',
        actor,
        updatedAt: new Date(),
      })
      .where(eq(schema.paymentEvents.id, id))
      .returning();

    this.logger.log(`결제 캡처됨: ${updatedEvent.id}`);
    // this.eventEmitter.emit('payment.captured', updatedEvent);
    return updatedEvent as PaymentEvent;
  }

  /**
   * 💡 [상태 업데이트] 기존 결제를 'FAILED' 상태로 변경합니다.
   * @param payload 실패 처리에 필요한 데이터 (업데이트할 이벤트 ID 포함)
   * @returns 업데이트된 PaymentEvent 객체
   */
  async failPayment(payload: FailPaymentPayload): Promise<PaymentEvent> {
    const { id, errorMessage, actor } = payload;

    // 실패는 어떤 상태에서든 발생할 수 있으므로, 이미 완료된 상태가 아닌지만 확인합니다.
    const eventToUpdate = await this.dbService.db.query.paymentEvents.findFirst(
      {
        where: eq(schema.paymentEvents.id, id),
      },
    );

    if (!eventToUpdate) {
      throw new NotFoundException(`결제 이벤트를 찾을 수 없습니다: ${id}`);
    }
    if (
      eventToUpdate.status === 'CAPTURED' ||
      eventToUpdate.status === 'FAILED'
    ) {
      throw new ConflictException(
        `이미 처리 완료된 결제입니다: ${eventToUpdate.status}`,
      );
    }

    const [updatedEvent] = await this.dbService.db
      .update(schema.paymentEvents)
      .set({
        status: 'FAILED',
        errorMessage,
        actor,
        updatedAt: new Date(),
      })
      .where(eq(schema.paymentEvents.id, id))
      .returning();

    this.logger.warn(
      `결제 실패 처리됨: ${updatedEvent.id}, 사유: ${errorMessage}`,
    );
    // this.eventEmitter.emit('payment.failed', updatedEvent);
    return updatedEvent as PaymentEvent;
  }

  /**
   * 인보이스 ID로 결제 이벤트 목록을 조회합니다.
   * @param invoiceId
   * @returns PaymentEvent 객체 배열
   */
  async getPaymentEventsByInvoiceId(
    invoiceId: string,
  ): Promise<PaymentEvent[]> {
    const events = await this.dbService.db.query.paymentEvents.findMany({
      where: eq(schema.paymentEvents.invoiceId, invoiceId),
    });
    return events as PaymentEvent[];
  }

  /**
   * 헬퍼 함수: 특정 ID의 이벤트를 찾아 상태를 검증합니다.
   * @param id 이벤트 ID
   * @param expectedStatus 기대하는 현재 상태
   * @returns 찾아낸 PaymentEvent 객체
   */
  private async findAndValidateState(
    id: string,
    expectedStatus: PaymentEvent['status'],
  ): Promise<PaymentEvent> {
    const event = await this.dbService.db.query.paymentEvents.findFirst({
      where: eq(schema.paymentEvents.id, id),
    });

    if (!event) {
      throw new NotFoundException(`결제 이벤트를 찾을 수 없습니다: ${id}`);
    }

    if (event.status !== expectedStatus) {
      throw new ConflictException(
        `잘못된 결제 상태입니다. 현재: ${event.status}, 필요: ${expectedStatus}`,
      );
    }

    return event as PaymentEvent;
  }

  // ... (환불 관련 로직도 위와 유사한 패턴으로 리팩토링 가능)
}
