import { Injectable, Logger } from '@nestjs/common';
import {
  TaxInvoicePort,
  TaxInvoiceRequest,
  TaxInvoiceResult,
} from './payment-provider.interface';
import { TaxInvoiceService } from '../services/tax-invoice.service';
import { CreateTaxInvoiceDto } from '../shared/zods/tax-invoices.zod';

/**
 * HMS BNPL 세금계산서 Provider
 *
 * 책임:
 * - HMS BNPL 결제 정보를 세금계산서 생성 요청으로 변환
 * - 기존 TaxInvoiceService를 활용하여 세금계산서 생성
 * - 배치 처리는 기존 스케줄링 시스템 활용 (엑셀 export → 홈택스 발급)
 *
 * 참고: 세금계산서는 HMS API가 아닌 자체 시스템에서 관리
 */
@Injectable()
export class HmsBnplTaxInvoiceProvider implements TaxInvoicePort {
  private readonly logger = new Logger(HmsBnplTaxInvoiceProvider.name);

  constructor(private readonly taxInvoiceService: TaxInvoiceService) {}

  async create(request: TaxInvoiceRequest): Promise<TaxInvoiceResult> {
    this.logger.log(
      `➡️ HMS BNPL 세금계산서 생성 요청 - Order: ${request.externalOrderId}, Amount: ${request.totalAmount}`,
    );

    try {
      // 1. HMS BNPL 요청을 기존 TaxInvoiceService DTO로 변환
      const createDto: CreateTaxInvoiceDto = {
        userId: request.userId,
        externalOrderId: request.externalOrderId,
        paymentIntentId: request.paymentIntentId,
        paymentAttemptId: request.paymentAttemptId,
        supplyDate: request.supplyDate,
        issueDate: request.issueDate,
        totalAmount: request.totalAmount,
        supplyAmount: request.supplyAmount,
        taxAmount: request.taxAmount,

        // HMS BNPL 특성: 일반 세금계산서
        kind: 'NORMAL',
        modificationType: undefined,
        originalInvoiceId: undefined,
        aggregationType: 'SINGLE', // HMS BNPL은 단일 주문 기준
        aggregationKey: undefined,

        // 고객 정보
        customerName: request.customerName,
        customerBusinessNumber: request.customerBusinessNumber,

        // 세금계산서 스냅샷 구성
        invoiceSnapshot: this.buildInvoiceSnapshot(request),
      };

      this.logger.debug('TaxInvoiceService 호출 DTO:', createDto);

      // 2. 기존 TaxInvoiceService를 통한 세금계산서 생성
      const createdInvoice =
        await this.taxInvoiceService.createTaxInvoice(createDto);

      this.logger.log(
        `✅ HMS BNPL 세금계산서 생성 성공 - InvoiceId: ${createdInvoice.id}, Status: ${createdInvoice.status}`,
      );

      return {
        success: true,
        invoiceId: createdInvoice.id,
        status: createdInvoice.status,
        code: 'SUCCESS',
        message: '세금계산서 생성 완료 (배치 처리 대기 중)',
        raw: createdInvoice,
      };
    } catch (error: any) {
      this.logger.error(
        `❌ HMS BNPL 세금계산서 생성 실패: ${error.message}`,
        error.stack,
      );

      // CTO 스타일: 서비스에서는 단순 Error만 던지고, 컨트롤러에서 HTTP 변환
      return {
        success: false,
        code: this.mapErrorCode(error.message),
        message: `세금계산서 생성 실패: ${error.message}`,
        raw: error,
      };
    }
  }

  /**
   * HMS BNPL 요청 정보로부터 세금계산서 스냅샷을 구성합니다.
   *
   * @param request HMS BNPL 세금계산서 요청
   * @returns 세금계산서 스냅샷 객체
   */
  private buildInvoiceSnapshot(request: TaxInvoiceRequest) {
    return {
      // 공급자 정보 (우리 회사)
      supplier: {
        businessNumber: process.env.SUPPLIER_BUSINESS_NUMBER || '123-45-67890',
        name: process.env.SUPPLIER_NAME || '아몬드영',
        ceoName: process.env.SUPPLIER_CEO_NAME || '대표자명',
        address: process.env.SUPPLIER_ADDRESS || '서울시 강남구',
        email: process.env.SUPPLIER_EMAIL || 'admin@almondyoung.com',
        businessType: '도매업',
        businessCategory: '미용용품',
      },

      // 고객 정보
      customer: {
        businessNumber: request.customerBusinessNumber,
        name: request.customerName,
        ceoName: request.customerName, // BNPL은 개인사업자 위주라 동일하게 설정
        address: '', // HMS BNPL에서는 주소 정보가 제한적
        email: '',
      },

      // 상품 정보 (HMS BNPL은 통합 결제이므로 단순화)
      items: [
        {
          name: '미용용품', // 기본 상품명
          spec: 'BNPL 결제 상품',
          quantity: 1,
          unitPrice: request.supplyAmount,
          supplyAmount: request.supplyAmount,
          taxAmount: request.taxAmount,
        },
      ],

      // 주문 메타 정보 (HMS BNPL 특성)
      orderMeta: {
        orderDate: new Date().toISOString().split('T')[0],
        deliveryDate: request.supplyDate,
        shippingAddress: '', // HMS BNPL에서는 배송 정보 제한적
      },

      // 기본 스냅샷에서 요구하는 추가 정보
      ...(request.invoiceSnapshot || {}),
    };
  }

  /**
   * 에러 메시지를 기반으로 에러 코드를 매핑합니다.
   * CTO 스타일: 문자열 패턴 기반 에러 처리
   */
  private mapErrorCode(errorMessage: string): string {
    const message = errorMessage.toLowerCase();

    if (message.includes('already exists')) {
      return 'TAX_INVOICE_DUPLICATE';
    }
    if (message.includes('amount mismatch')) {
      return 'TAX_INVOICE_AMOUNT_INVALID';
    }
    if (message.includes('not found')) {
      return 'TAX_INVOICE_DATA_NOT_FOUND';
    }
    if (message.includes('invalid')) {
      return 'TAX_INVOICE_INVALID_INPUT';
    }

    return 'TAX_INVOICE_CREATION_ERROR';
  }
}
