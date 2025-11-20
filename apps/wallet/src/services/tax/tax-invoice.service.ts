import { Injectable, Logger, Inject } from '@nestjs/common';
import { DbService } from '@app/db';
import { walletSchema } from '../../shared/database/schema';
import { TaxInvoiceReader } from './tax-invoice.reader';
import { TaxInvoiceCreator } from './tax-invoice.creator';
import { TaxInvoiceManager } from './tax-invoice.manager';
import { TaxInvoiceRepository } from './tax-invoice.repository';
import { TaxInvoicePreferenceService } from './tax-invoice-preference.service';
import type { IOmsClient } from './oms-client.interface';
import type {
  TaxInvoice,
  TaxInvoiceWithSnapshot,
  TaxInvoiceWithEvents,
  BusinessInfo,
} from '../../shared/database/types';
import type { CreateIntentDto } from '../../shared/zods/tax-invoices.zod';

/**
 * TaxInvoiceService (Business Layer)
 *
 * 책임: 비즈니스 흐름만 표현 (2-3줄)
 * - DB 직접 참조 제거
 * - Reader/Creator/Manager를 통해서만 접근
 */
@Injectable()
export class TaxInvoiceService {
  private readonly logger = new Logger(TaxInvoiceService.name);

  constructor(
    private readonly db: DbService<typeof walletSchema>,
    private readonly reader: TaxInvoiceReader,
    private readonly creator: TaxInvoiceCreator,
    private readonly manager: TaxInvoiceManager,
    private readonly repository: TaxInvoiceRepository,
    private readonly preferenceService: TaxInvoicePreferenceService,
    @Inject('OMS_CLIENT') private readonly omsClient: IOmsClient,
  ) {}

  /**
   * 세금계산서 신청 (명세서 기준)
   */
  async createIntent(
    userId: string,
    dto: CreateIntentDto,
  ): Promise<TaxInvoice> {
    return await this.db.db.transaction(async (tx) => {
      // 1. [트랜잭션 밖] OMS에 주문 정보 요청 (5초 타임아웃)
      const order = await this.fetchOrderWithTimeout(dto.orderId, 5000);

      // 2. 주문 검증
      this.validateOrder(order, userId);

      // 3. [트랜잭션 안] 중복 체크 with 행 잠금
      const existing = await this.repository.findByOrderIdForUpdate(
        dto.orderId,
        tx,
      );

      if (existing) {
        const activeStatuses = [
          'REQUESTED',
          'EXPORTED',
          'ISSUED_CONFIRMED',
          'NEEDS_MODIFICATION',
        ];
        if (activeStatuses.includes(existing.status)) {
          throw new Error('이미 처리 중인 세금계산서가 있습니다');
        }

        // FAILED, CANCELLED 상태면 재발행 불가 (새로 신청해야 함)
        if (existing.status === 'FAILED' || existing.status === 'CANCELLED') {
          throw new Error(
            '이전 세금계산서가 실패/취소되었습니다. 관리자에게 문의하세요.',
          );
        }
      }

      // 4. 사업자 정보 준비
      const businessInfo = await this.prepareBusinessInfo(userId, dto, tx);

      // 5. 세금계산서 생성
      const invoice = await this.creator.create(
        {
          userId,
          order,
          businessInfo,
        },
        tx,
      );

      this.logger.log(
        `세금계산서 신청 완료: ${invoice.id} (주문: ${dto.orderId})`,
      );
      return invoice;
    });
  }

  /**
   * 내 세금계산서 목록 조회
   */
  async getMyInvoices(params: {
    userId: string;
    status?: string;
    fromDate?: string;
    toDate?: string;
    limit: number;
    offset: number;
  }): Promise<TaxInvoice[]> {
    return await this.reader.findByUserId(params);
  }

  /**
   * 세금계산서 상세 조회 (스냅샷 포함)
   */
  async getInvoiceWithSnapshot(
    invoiceId: string,
  ): Promise<TaxInvoiceWithSnapshot | null> {
    return await this.reader.findWithSnapshot(invoiceId);
  }

  /**
   * 세금계산서 상세 조회 (이벤트 포함)
   */
  async getInvoiceWithEvents(
    invoiceId: string,
  ): Promise<TaxInvoiceWithEvents | null> {
    return await this.reader.findWithEvents(invoiceId);
  }

  /**
   * OMS 웹훅 이벤트 처리
   */
  async handleOmsWebhook(event: {
    eventId: string;
    orderId: string;
    userId: string;
    eventType: 'CANCELLED' | 'REFUNDED' | 'PARTIAL_REFUNDED';
    amount?: number;
    timestamp: Date;
  }): Promise<void> {
    return await this.db.db.transaction(async (tx) => {
      // 1. 이벤트 중복 체크는 Controller에서 처리됨

      // 2. 세금계산서 조회 with 잠금
      const invoice = await this.repository.findByOrderIdForUpdate(
        event.orderId,
        tx,
      );

      if (!invoice) {
        this.logger.log(
          `세금계산서가 없는 주문입니다 (스킵): ${event.orderId}`,
        );
        return;
      }

      // 3. OMS 이벤트 처리
      await this.manager.handleOmsEvent(
        invoice,
        event.eventType,
        event.eventId,
        event.amount,
        tx,
      );

      this.logger.log(
        `OMS 이벤트 처리 완료: ${event.eventType} for invoice ${invoice.id}`,
      );
    });
  }

  /**
   * OMS 주문 조회 (타임아웃 적용)
   */
  private async fetchOrderWithTimeout(
    orderId: string,
    timeoutMs: number,
  ): Promise<any> {
    try {
      const order = await Promise.race([
        this.omsClient.getOrder(orderId),
        this.timeoutPromise(timeoutMs),
      ]);
      return order;
    } catch (error) {
      this.logger.error(`OMS 요청 실패: ${error.message}`);
      throw new Error('주문 정보를 확인할 수 없습니다');
    }
  }

  /**
   * 타임아웃 Promise
   */
  private timeoutPromise(ms: number): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), ms),
    );
  }

  /**
   * 주문 검증
   */
  private validateOrder(order: any, userId: string): void {
    if (!order) {
      throw new Error('주문을 찾을 수 없습니다');
    }
    if (order.userId !== userId) {
      throw new Error('주문 소유자가 다릅니다');
    }
    if (order.status === 'CANCELLED') {
      throw new Error('취소된 주문입니다');
    }
    if (order.amount < 10000) {
      throw new Error('1만원 이상 주문만 발행 가능합니다');
    }
  }

  /**
   * 사업자 정보 준비
   */
  private async prepareBusinessInfo(
    userId: string,
    dto: CreateIntentDto,
    tx: any,
  ): Promise<BusinessInfo> {
    // 1. Preference 조회
    const preference = await this.preferenceService.getPreference(userId, tx);

    // 2. 우선순위: preference > DTO
    if (preference?.defaultEnabled && preference.defaultBusinessInfo) {
      return preference.defaultBusinessInfo as BusinessInfo;
    }

    if (dto.businessInfo) {
      return dto.businessInfo;
    }

    throw new Error('사업자 정보가 필요합니다');
  }
}

