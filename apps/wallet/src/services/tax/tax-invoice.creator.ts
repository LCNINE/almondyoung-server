import { Injectable, Logger } from '@nestjs/common';
import { TaxInvoiceRepository } from './tax-invoice.repository';
import { generateUUIDv7 } from '../../shared/utils/id-generator';
import { SUPPLIER_PROFILE } from '../../config/supplier-profile';
import type {
  TaxInvoice,
  NewTaxInvoice,
  NewTaxInvoiceSnapshot,
  NewTaxInvoiceEvent,
  BusinessInfo,
  TaxInvoiceSnapshotPayload,
} from '../../shared/database/types';
import type { WalletExecutor } from '../../shared/database';
import type { OmsOrder } from './oms-client.interface';

export interface CreateTaxInvoiceParams {
  userId: string;
  order: OmsOrder;
  businessInfo: BusinessInfo;
}

/**
 * TaxInvoiceCreator - 세금계산서 생성 (Implementation Layer)
 *
 * 책임: 세금계산서 생성 로직 (검증 + 데이터 생성 + DB 저장)
 */
@Injectable()
export class TaxInvoiceCreator {
  private readonly logger = new Logger(TaxInvoiceCreator.name);

  constructor(private readonly repo: TaxInvoiceRepository) {}

  /**
   * 세금계산서 생성
   */
  async create(
    params: CreateTaxInvoiceParams,
    tx: WalletExecutor,
  ): Promise<TaxInvoice> {
    // 1. 검증
    this.validateParams(params);

    // 2. 금액 계산 (부가세 역산: totalAmount = supplyAmount + taxAmount)
    const amounts = this.calculateAmounts(params.order.amount);

    // 3. 공급시기 (주문 완료일)
    const completedAt = params.order.completedAt || params.order.updatedAt;
    const supplyDate = this.formatDate(completedAt);

    // 4. 세금계산서 데이터 생성
    const newInvoice: NewTaxInvoice = {
      id: generateUUIDv7(),
      userId: params.userId,
      orderId: params.order.orderId,
      status: 'REQUESTED',
      supplyDate,
      businessName: params.businessInfo.name,
      businessNumber: params.businessInfo.businessNumber,
      businessAddress: params.businessInfo.address,
      businessOwnerName: params.businessInfo.ownerName,
      supplyAmount: amounts.supplyAmount,
      taxAmount: amounts.taxAmount,
      totalAmount: amounts.totalAmount,
    };

    // 5. DB 저장
    const created = await this.repo.create(newInvoice, tx);

    // 6. 스냅샷 생성 (홈택스 제출용 - 확장 버전)
    await this.createSnapshot(created, params, amounts, tx);

    // 7. Audit 로그
    await this.logEvent(
      {
        invoiceId: created.id,
        eventType: 'TAX_INVOICE_REQUESTED',
        newStatus: 'REQUESTED',
        actor: params.userId,
        reasonDetail: `세금계산서 신청 - 주문 ID: ${params.order.orderId}`,
      },
      tx,
    );

    this.logger.log(
      `TaxInvoice created: ${created.id} for order ${params.order.orderId}`,
    );
    return created;
  }

  /**
   * 파라미터 검증
   */
  private validateParams(params: CreateTaxInvoiceParams): void {
    if (!params.userId) throw new Error('User ID required');
    if (!params.order) throw new Error('Order info required');
    if (!params.order.orderId) throw new Error('Order ID required');
    if (params.order.amount <= 0) throw new Error('Invalid order amount');
    if (params.order.amount < 10000) {
      throw new Error('1만원 이상 주문만 발행 가능');
    }
    if (!params.businessInfo) throw new Error('Business info required');
    if (!params.businessInfo.name) throw new Error('Business name required');
    if (!params.businessInfo.businessNumber) {
      throw new Error('Business number required');
    }
    if (!params.businessInfo.address) {
      throw new Error('Business address required');
    }
    if (!params.businessInfo.ownerName) {
      throw new Error('Business owner name required');
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
    // 총액 = 공급가액 + 세액
    // 세율 10%: 총액 = 공급가액 * 1.1
    // 공급가액 = 총액 / 1.1
    const supplyAmount = Math.round(totalAmount / 1.1);
    const taxAmount = totalAmount - supplyAmount;

    return {
      supplyAmount,
      taxAmount,
      totalAmount,
    };
  }

  /**
   * 날짜 포맷 (YYYY-MM-DD)
   */
  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  /**
   * 스냅샷 생성 (홈택스 제출용 완전한 데이터 - 확장 버전)
   */
  private async createSnapshot(
    invoice: TaxInvoice,
    params: CreateTaxInvoiceParams,
    amounts: { supplyAmount: number; taxAmount: number; totalAmount: number },
    tx: WalletExecutor,
  ): Promise<void> {
    const completedAt = params.order.completedAt || params.order.updatedAt;
    const issueDate = this.formatDate(completedAt);

    const payload: TaxInvoiceSnapshotPayload = {
      supplier: {
        businessNumber: SUPPLIER_PROFILE.businessNumber,
        name: SUPPLIER_PROFILE.name,
        ownerName: SUPPLIER_PROFILE.ownerName,
        address: SUPPLIER_PROFILE.address,
        businessType: SUPPLIER_PROFILE.businessType,
        businessItem: SUPPLIER_PROFILE.businessItem,
        email: SUPPLIER_PROFILE.email,
      },
      buyer: {
        businessNumber: params.businessInfo.businessNumber,
        name: params.businessInfo.name,
        ownerName: params.businessInfo.ownerName,
        address: params.businessInfo.address,
        businessType: params.businessInfo.businessType,
        businessItem: params.businessInfo.businessItem,
        email: params.businessInfo.email,
      },
      order: {
        orderId: params.order.orderId,
        orderNumber: params.order.orderNumber,
        completedAt: completedAt.toISOString(),
        status: this.mapOrderStatus(params.order.status),
        paymentMethod: params.order.paymentMethod || 'CARD',
        memo: params.order.memo,
        lines:
          params.order.items?.map((item) => ({
            productName: item.itemName,
            specification: item.specification,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            amount: Math.floor(item.totalPrice / 1.1), // 공급가액
          })) || [],
      },
      amounts: {
        supplyAmount: amounts.supplyAmount,
        taxAmount: amounts.taxAmount,
        totalAmount: amounts.totalAmount,
        issueDate,
      },
    };

    const snapshotData: NewTaxInvoiceSnapshot = {
      invoiceId: invoice.id,
      payload: payload as any,
    };

    await this.repo.createSnapshot(snapshotData, tx);
  }

  /**
   * OMS 주문 상태 → 스냅샷 상태 매핑
   */
  private mapOrderStatus(
    status: string,
  ): 'COMPLETED' | 'CANCELLED' | 'REFUNDED' {
    if (status === 'CANCELLED') return 'CANCELLED';
    if (status === 'REFUNDED') return 'REFUNDED';
    return 'COMPLETED';
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
    tx: WalletExecutor,
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
