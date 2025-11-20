import { Injectable, Logger } from '@nestjs/common';
import { TaxInvoiceRepository } from './tax-invoice.repository';
import { generateUUIDv7 } from '../../shared/utils/id-generator';
import type {
  TaxInvoice,
  UpdateTaxInvoice,
  NewTaxInvoiceEvent,
  TaxInvoiceStatus,
  TAX_INVOICE_TRANSITIONS,
} from '../../shared/database/types';
import type { WalletExecutor } from '../../shared/database';

/**
 * TaxInvoiceManager (Implementation Layer)
 *
 * 책임: 세금계산서 비즈니스 로직 (검증 + 상태 관리 + DB 접근)
 */
@Injectable()
export class TaxInvoiceManager {
  private readonly logger = new Logger(TaxInvoiceManager.name);

  // 상태 전이 매트릭스
  private readonly TRANSITIONS: Record<TaxInvoiceStatus, TaxInvoiceStatus[]> =
    {
      REQUESTED: ['EXPORTED', 'CANCELLED'],
      EXPORTED: ['ISSUED_CONFIRMED', 'FAILED'],
      ISSUED_CONFIRMED: ['NEEDS_MODIFICATION'],
      FAILED: ['REQUESTED'],
      CANCELLED: ['REQUESTED'],
      NEEDS_MODIFICATION: ['EXPORTED'],
    };

  constructor(
    private readonly repo: TaxInvoiceRepository,
  ) {}

  /**
   * 상태 전이 가능 여부 확인
   */
  canTransition(from: string, to: string): boolean {
    const allowed = this.TRANSITIONS[from as TaxInvoiceStatus];
    return allowed ? allowed.includes(to as TaxInvoiceStatus) : false;
  }

  /**
   * 상태 전이 검증 (에러 발생)
   */
  validateTransition(from: string, to: string): void {
    if (!this.canTransition(from, to)) {
      throw new Error(
        `Invalid status transition: ${from} -> ${to}. Allowed: ${this.TRANSITIONS[from as TaxInvoiceStatus]?.join(', ') || 'none'}`,
      );
    }
  }

  /**
   * 엑셀 내보내기 처리 (REQUESTED -> EXPORTED)
   */
  async markAsExported(
    invoice: TaxInvoice,
    operator: string,
    exportBatchId: string,
    tx: WalletExecutor,
  ): Promise<void> {
    // 1. 상태 전이 검증
    this.validateTransition(invoice.status, 'EXPORTED');

    // 2. 상태 업데이트
    const updateData: UpdateTaxInvoice = {
      status: 'EXPORTED',
      exportedAt: new Date(),
      exportedBy: operator,
    };

    await this.repo.update(invoice.id, updateData, tx);

    // 3. Audit 로그
    await this.logEvent(
      {
        invoiceId: invoice.id,
        eventType: 'TAX_INVOICE_EXPORTED',
        previousStatus: invoice.status,
        newStatus: 'EXPORTED',
        actor: operator,
        reasonDetail: `엑셀 내보내기 처리 - 배치 ID: ${exportBatchId}`,
      },
      tx,
    );

    this.logger.log(`TaxInvoice ${invoice.id} marked as EXPORTED`);
  }

  /**
   * 발행 완료 처리 (EXPORTED -> ISSUED_CONFIRMED)
   */
  async confirmIssued(
    invoice: TaxInvoice,
    hometaxIssueNo: string,
    hometaxIssueDate: string,
    operator: string,
    tx: WalletExecutor,
  ): Promise<void> {
    // 1. 상태 전이 검증
    this.validateTransition(invoice.status, 'ISSUED_CONFIRMED');

    // 2. 홈택스 번호 중복 체크
    const existing = await this.repo.findByHometaxIssueNo(
      hometaxIssueNo,
      tx,
    );
    if (existing && existing.id !== invoice.id) {
      throw new Error('중복된 홈택스 발행번호');
    }

    // 3. 상태 업데이트
    const updateData: UpdateTaxInvoice = {
      status: 'ISSUED_CONFIRMED',
      hometaxIssueNo,
      hometaxIssueDate,
      uploadedAt: new Date(),
    };

    await this.repo.update(invoice.id, updateData, tx);

    // 4. Audit 로그
    await this.logEvent(
      {
        invoiceId: invoice.id,
        eventType: 'TAX_INVOICE_ISSUED',
        previousStatus: invoice.status,
        newStatus: 'ISSUED_CONFIRMED',
        actor: operator,
        reasonDetail: `홈택스 발행 완료 - 발행번호: ${hometaxIssueNo}`,
      },
      tx,
    );

    this.logger.log(
      `TaxInvoice ${invoice.id} confirmed as ISSUED - ${hometaxIssueNo}`,
    );
  }

  /**
   * 발행 실패 처리 (EXPORTED -> FAILED)
   */
  async markAsFailed(
    invoice: TaxInvoice,
    failReason: string,
    errorCode: string | undefined,
    operator: string,
    tx: WalletExecutor,
  ): Promise<void> {
    // 1. 상태 전이 검증
    this.validateTransition(invoice.status, 'FAILED');

    // 2. 상태 업데이트
    const updateData: UpdateTaxInvoice = {
      status: 'FAILED',
      failReason,
      errorCode,
    };

    await this.repo.update(invoice.id, updateData, tx);

    // 3. Audit 로그
    await this.logEvent(
      {
        invoiceId: invoice.id,
        eventType: 'TAX_INVOICE_FAILED',
        previousStatus: invoice.status,
        newStatus: 'FAILED',
        actor: operator,
        reasonCode: errorCode,
        reasonDetail: `발행 실패 - ${failReason}`,
      },
      tx,
    );

    this.logger.warn(`TaxInvoice ${invoice.id} marked as FAILED: ${failReason}`);
  }

  /**
   * 취소 처리 (REQUESTED -> CANCELLED)
   */
  async cancel(
    invoice: TaxInvoice,
    cancelReason: string,
    actor: string,
    tx: WalletExecutor,
  ): Promise<void> {
    // 1. 상태 전이 검증
    this.validateTransition(invoice.status, 'CANCELLED');

    // 2. 상태 업데이트
    const updateData: UpdateTaxInvoice = {
      status: 'CANCELLED',
      cancelReason,
    };

    await this.repo.update(invoice.id, updateData, tx);

    // 3. Audit 로그
    await this.logEvent(
      {
        invoiceId: invoice.id,
        eventType: 'TAX_INVOICE_CANCELLED',
        previousStatus: invoice.status,
        newStatus: 'CANCELLED',
        actor,
        reasonDetail: `취소 - ${cancelReason}`,
      },
      tx,
    );

    this.logger.log(`TaxInvoice ${invoice.id} cancelled: ${cancelReason}`);
  }

  /**
   * 수정발행 필요 상태로 변경 (ISSUED_CONFIRMED -> NEEDS_MODIFICATION)
   */
  async markAsNeedsModification(
    invoice: TaxInvoice,
    reason: string,
    newAmount?: number,
    tx?: WalletExecutor,
  ): Promise<void> {
    // 1. 상태 전이 검증
    this.validateTransition(invoice.status, 'NEEDS_MODIFICATION');

    // 2. 상태 업데이트
    const updateData: UpdateTaxInvoice = {
      status: 'NEEDS_MODIFICATION',
    };

    await this.repo.update(invoice.id, updateData, tx);

    // 3. Audit 로그
    await this.logEvent(
      {
        invoiceId: invoice.id,
        eventType: 'TAX_INVOICE_NEEDS_MODIFICATION',
        previousStatus: invoice.status,
        newStatus: 'NEEDS_MODIFICATION',
        previousAmount: invoice.totalAmount,
        newAmount,
        actor: 'SYSTEM',
        reasonDetail: `수정발행 필요 - ${reason}`,
      },
      tx,
    );

    this.logger.log(
      `TaxInvoice ${invoice.id} marked as NEEDS_MODIFICATION: ${reason}`,
    );
  }

  /**
   * OMS 이벤트 처리 (주문 취소/환불)
   */
  async handleOmsEvent(
    invoice: TaxInvoice,
    eventType: 'CANCELLED' | 'REFUNDED' | 'PARTIAL_REFUNDED',
    eventId: string,
    amount?: number,
    tx?: WalletExecutor,
  ): Promise<void> {
    this.logger.log(
      `Handling OMS event ${eventType} for invoice ${invoice.id}`,
    );

    if (eventType === 'CANCELLED') {
      await this.handleCancellation(invoice, eventId, tx);
    } else if (eventType === 'PARTIAL_REFUNDED') {
      await this.handlePartialRefund(invoice, eventId, amount || 0, tx);
    } else if (eventType === 'REFUNDED') {
      await this.handleFullRefund(invoice, eventId, tx);
    }
  }

  /**
   * 주문 취소 처리
   */
  private async handleCancellation(
    invoice: TaxInvoice,
    eventId: string,
    tx?: WalletExecutor,
  ): Promise<void> {
    if (invoice.status === 'REQUESTED') {
      // 발행 전 취소 -> CANCELLED
      await this.cancel(invoice, `주문 취소 (OMS Event: ${eventId})`, 'SYSTEM', tx as WalletExecutor);
    } else if (invoice.status === 'ISSUED_CONFIRMED') {
      // 발행 후 취소 -> NEEDS_MODIFICATION
      await this.markAsNeedsModification(
        invoice,
        `주문 취소 (OMS Event: ${eventId})`,
        0,
        tx,
      );
    } else if (invoice.status === 'EXPORTED') {
      // 내보내기 후 취소 -> 경고 로그만
      this.logger.warn(
        `Cannot cancel invoice ${invoice.id} in EXPORTED status. Manual intervention required.`,
      );
    }
  }

  /**
   * 부분 환불 처리
   */
  private async handlePartialRefund(
    invoice: TaxInvoice,
    eventId: string,
    refundAmount: number,
    tx?: WalletExecutor,
  ): Promise<void> {
    if (invoice.status === 'REQUESTED') {
      // 발행 전 부분 환불 -> 금액 업데이트 (스냅샷 재생성 필요)
      const newTotalAmount = invoice.totalAmount - refundAmount;
      const amounts = this.calculateAmounts(newTotalAmount);

      await this.repo.update(
        invoice.id,
        {
          supplyAmount: amounts.supplyAmount,
          taxAmount: amounts.taxAmount,
          totalAmount: amounts.totalAmount,
        },
        tx,
      );

      await this.logEvent(
        {
          invoiceId: invoice.id,
          eventType: 'AMOUNT_UPDATED',
          previousAmount: invoice.totalAmount,
          newAmount: newTotalAmount,
          actor: 'SYSTEM',
          reasonDetail: `부분 환불 (OMS Event: ${eventId})`,
        },
        tx,
      );
    } else if (
      invoice.status === 'EXPORTED' ||
      invoice.status === 'ISSUED_CONFIRMED'
    ) {
      // 발행 중/후 부분 환불 -> NEEDS_MODIFICATION
      const newTotalAmount = invoice.totalAmount - refundAmount;
      await this.markAsNeedsModification(
        invoice,
        `부분 환불 ${refundAmount}원 (OMS Event: ${eventId})`,
        newTotalAmount,
        tx,
      );
    }
  }

  /**
   * 전액 환불 처리
   */
  private async handleFullRefund(
    invoice: TaxInvoice,
    eventId: string,
    tx?: WalletExecutor,
  ): Promise<void> {
    // 모든 상태에서 NEEDS_MODIFICATION으로 전환
    if (invoice.status === 'REQUESTED') {
      await this.cancel(
        invoice,
        `전액 환불 (OMS Event: ${eventId})`,
        'SYSTEM',
        tx as WalletExecutor,
      );
    } else if (
      invoice.status === 'EXPORTED' ||
      invoice.status === 'ISSUED_CONFIRMED'
    ) {
      await this.markAsNeedsModification(
        invoice,
        `전액 환불 (OMS Event: ${eventId})`,
        0,
        tx,
      );
    }
  }

  /**
   * 금액 계산 (부가세 역산)
   */
  private calculateAmounts(totalAmount: number): {
    supplyAmount: number;
    taxAmount: number;
    totalAmount: number;
  } {
    const supplyAmount = Math.floor(totalAmount / 1.1);
    const taxAmount = totalAmount - supplyAmount;
    return { supplyAmount, taxAmount, totalAmount };
  }

  /**
   * Audit 이벤트 로그
   */
  private async logEvent(
    data: {
      invoiceId: string;
      eventType: string;
      previousStatus?: string;
      newStatus?: string;
      previousAmount?: number;
      newAmount?: number;
      reasonCode?: string;
      reasonDetail?: string;
      actor: string;
    },
    tx?: WalletExecutor,
  ): Promise<void> {
    const eventData: NewTaxInvoiceEvent = {
      id: generateUUIDv7(),
      invoiceId: data.invoiceId,
      eventType: data.eventType,
      previousStatus: data.previousStatus,
      newStatus: data.newStatus,
      previousAmount: data.previousAmount,
      newAmount: data.newAmount,
      reasonCode: data.reasonCode,
      reasonDetail: data.reasonDetail,
      actor: data.actor,
    };

    await this.repo.createEvent(eventData, tx);
  }
}

