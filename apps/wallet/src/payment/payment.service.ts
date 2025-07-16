import { Injectable, Logger } from '@nestjs/common';
import { ulid } from 'ulid';
import { eq } from 'drizzle-orm';
import * as schema from './schema';
import { DbService, InjectDb } from '@app/db';
import {
    PaymentEvent,
    PaymentEventDb,
    RefundEvent,
    RefundEventDb,
    paymentEvents,
    refundEvents
} from './schema';
import {
    CreatePaymentEventDto,
    PaymentRequestDto,
    PaymentSuccessDto,
    PaymentFailureDto
} from './dto/payment-event.dto';
import {
    CreateRefundEventDto,
    RefundRequestDto,
    RefundSuccessDto,
    RefundFailureDto
} from './dto/refund-event.dto';
import { parseDecimal, toDecimalString } from './utils/money.utils';

/**
 * 결제 서비스 - 이벤트 소싱 패턴 구현
 * 
 * 주요 역할:
 * 1. 결제 이벤트 생성 및 관리
 * 2. 환불 이벤트 생성 및 관리
 * 3. 결제 상태 조회
 */
@Injectable()
export class PaymentService {
    private readonly logger = new Logger(PaymentService.name);

    constructor(@InjectDb() private readonly dbService: DbService<typeof schema>) {
        this.logger.log('🚀 Payment 서비스 초기화 완료');
    }

    /**
     * 결제 이벤트 생성
     * 
     * @param paymentEventData 결제 이벤트 데이터 (이미 검증된 DTO)
     * @returns 생성된 결제 이벤트
     */
    async createPaymentEvent(paymentEventData: CreatePaymentEventDto): Promise<PaymentEvent> {
        this.logger.log(`결제 이벤트 생성 시작: invoiceId=${paymentEventData.invoiceId}, amount=${paymentEventData.amount}`);

        try {
            // 결제 이벤트 ID 생성
            const id = ulid();

            // 결제 이벤트 생성 (amount를 string으로 변환하여 저장)
            const [createdEvent] = await this.dbService.db.insert(paymentEvents)
                .values({
                    id,
                    ...paymentEventData,
                    amount: toDecimalString(paymentEventData.amount), // number를 string으로 변환
                    createdAt: new Date(),
                })
                .returning();

            this.logger.log(`결제 이벤트 생성 완료: id=${id}, status=${paymentEventData.status}`);

            return {
                ...createdEvent,
                amount: parseDecimal(createdEvent.amount), // DB string을 number로 변환
                createdAt: new Date(createdEvent.createdAt),
            };
        } catch (error) {
            this.logger.error(`결제 이벤트 생성 실패: ${error.message}`);
            throw error;
        }
    }

    /**
     * 환불 이벤트 생성
     * 
     * @param refundEventData 환불 이벤트 데이터 (이미 검증된 DTO)
     * @returns 생성된 환불 이벤트
     */
    async createRefundEvent(refundEventData: CreateRefundEventDto): Promise<RefundEvent> {
        this.logger.log(`환불 이벤트 생성 시작: paymentEventId=${refundEventData.paymentEventId}, amount=${refundEventData.amount}`);

        try {
            // 환불 이벤트 ID 생성
            const id = ulid();

            // 환불 이벤트 생성 (amount를 string으로 변환하여 저장)
            const [createdEvent] = await this.dbService.db.insert(refundEvents)
                .values({
                    id,
                    ...refundEventData,
                    amount: toDecimalString(refundEventData.amount), // number를 string으로 변환
                    createdAt: new Date(),
                })
                .returning();

            this.logger.log(`환불 이벤트 생성 완료: id=${id}, status=${refundEventData.status}`);

            return {
                ...createdEvent,
                amount: parseDecimal(createdEvent.amount), // DB string을 number로 변환
                createdAt: new Date(createdEvent.createdAt),
            };
        } catch (error) {
            this.logger.error(`환불 이벤트 생성 실패: ${error.message}`);
            throw error;
        }
    }

    /**
     * 결제 요청 이벤트 생성
     * 
     * @param paymentData 결제 요청 데이터 (이미 검증된 DTO)
     * @returns 생성된 결제 이벤트
     */
    async requestPayment(paymentData: PaymentRequestDto): Promise<PaymentEvent> {
        return this.createPaymentEvent({
            ...paymentData,
            status: 'REQUESTED',
        });
    }

    /**
     * 결제 성공 이벤트 생성
     * 
     * @param paymentData 결제 성공 데이터 (이미 검증된 DTO)
     * @returns 생성된 결제 이벤트
     */
    async successPayment(paymentData: PaymentSuccessDto): Promise<PaymentEvent> {
        return this.createPaymentEvent({
            ...paymentData,
            status: 'SUCCESS',
        });
    }

    /**
     * 결제 실패 이벤트 생성
     * 
     * @param paymentData 결제 실패 데이터 (이미 검증된 DTO)
     * @returns 생성된 결제 이벤트
     */
    async failPayment(paymentData: PaymentFailureDto): Promise<PaymentEvent> {
        return this.createPaymentEvent({
            ...paymentData,
            status: 'FAILED',
        });
    }

    /**
     * 환불 요청 이벤트 생성
     * 
     * @param refundData 환불 요청 데이터 (이미 검증된 DTO)
     * @returns 생성된 환불 이벤트
     */
    async requestRefund(refundData: RefundRequestDto): Promise<RefundEvent> {
        return this.createRefundEvent({
            ...refundData,
            status: 'REQUESTED',
        });
    }

    /**
     * 환불 성공 이벤트 생성
     * 
     * @param refundData 환불 성공 데이터 (이미 검증된 DTO)
     * @returns 생성된 환불 이벤트
     */
    async successRefund(refundData: RefundSuccessDto): Promise<RefundEvent> {
        return this.createRefundEvent({
            ...refundData,
            status: 'SUCCESS',
        });
    }

    /**
     * 환불 실패 이벤트 생성
     * 
     * @param refundData 환불 실패 데이터 (이미 검증된 DTO)
     * @returns 생성된 환불 이벤트
     */
    async failRefund(refundData: RefundFailureDto): Promise<RefundEvent> {
        return this.createRefundEvent({
            ...refundData,
            status: 'FAILED',
        });
    }

    /**
     * 결제 이벤트 조회
     * 
     * @param paymentEventId 결제 이벤트 ID
     * @returns 결제 이벤트
     */
    async getPaymentEvent(paymentEventId: string): Promise<PaymentEvent | null> {
        try {
            const event = await this.dbService.db.query.paymentEvents.findFirst({
                where: eq(paymentEvents.id, paymentEventId),
            });

            if (!event) {
                return null;
            }

            return {
                ...event,
                amount: parseDecimal(event.amount), // DB string을 number로 변환
                createdAt: new Date(event.createdAt),
            };
        } catch (error) {
            this.logger.error(`결제 이벤트 조회 실패: ${error.message}`);
            throw error;
        }
    }

    /**
     * 인보이스 ID로 결제 이벤트 조회
     * 
     * @param invoiceId 인보이스 ID
     * @returns 결제 이벤트 목록
     */
    async getPaymentEventsByInvoiceId(invoiceId: number): Promise<PaymentEvent[]> {
        try {
            const events = await this.dbService.db.query.paymentEvents.findMany({
                where: eq(paymentEvents.invoiceId, invoiceId),
                orderBy: (paymentEvents, { desc }) => [desc(paymentEvents.createdAt)],
            });

            return events.map(event => ({
                ...event,
                amount: parseDecimal(event.amount), // DB string을 number로 변환
                createdAt: new Date(event.createdAt),
            }));
        } catch (error) {
            this.logger.error(`인보이스 ID로 결제 이벤트 조회 실패: ${error.message}`);
            throw error;
        }
    }

    /**
     * 결제 이벤트 ID로 환불 이벤트 조회
     * 
     * @param paymentEventId 결제 이벤트 ID
     * @returns 환불 이벤트 목록
     */
    async getRefundEventsByPaymentEventId(paymentEventId: string): Promise<RefundEvent[]> {
        try {
            const events = await this.dbService.db.query.refundEvents.findMany({
                where: eq(refundEvents.paymentEventId, paymentEventId),
                orderBy: (refundEvents, { desc }) => [desc(refundEvents.createdAt)],
            });

            return events.map(event => ({
                ...event,
                amount: parseDecimal(event.amount), // DB string을 number로 변환
                createdAt: new Date(event.createdAt),
            }));
        } catch (error) {
            this.logger.error(`결제 이벤트 ID로 환불 이벤트 조회 실패: ${error.message}`);
            throw error;
        }
    }
}