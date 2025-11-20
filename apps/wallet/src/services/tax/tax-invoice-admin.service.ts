import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { walletSchema } from '../../shared/database/schema';
import { TaxInvoiceReader } from './tax-invoice.reader';
import { TaxInvoiceManager } from './tax-invoice.manager';
import { TaxInvoiceRepository } from './tax-invoice.repository';
import { generateUUIDv7 } from '../../shared/utils/id-generator';
import { SUPPLIER_PROFILE } from '../../config/supplier-profile';
import type {
  TaxInvoice,
  TaxInvoiceSnapshotPayload,
  HometaxExportRow,
} from '../../shared/database/types';

/**
 * TaxInvoiceAdminService
 *
 * 책임: 관리자용 세금계산서 발행 처리 (명세서 기준)
 */
@Injectable()
export class TaxInvoiceAdminService {
  private readonly logger = new Logger(TaxInvoiceAdminService.name);

  constructor(
    private readonly db: DbService<typeof walletSchema>,
    private readonly reader: TaxInvoiceReader,
    private readonly manager: TaxInvoiceManager,
    private readonly repository: TaxInvoiceRepository,
  ) {}

  /**
   * 발행 대기 목록 조회 (REQUESTED 상태)
   */
  async getRequested(limit: number, offset: number): Promise<TaxInvoice[]> {
    return await this.reader.findRequested(limit, offset);
  }

  /**
   * 전체 세금계산서 조회 (필터링)
   */
  async getAll(params: {
    status?: string;
    userId?: string;
    fromDate?: string;
    toDate?: string;
    limit: number;
    offset: number;
  }): Promise<TaxInvoice[]> {
    return await this.reader.findAll(params);
  }

  /**
   * 엑셀 내보내기 처리 (일괄)
   * REQUESTED -> EXPORTED
   */
  async markExported(
    invoiceIds: string[],
    operator: string,
  ): Promise<{
    success: string[];
    failed: Array<{ id: string; reason: string }>;
    batchId: string;
    exportedAt: Date;
  }> {
    const batchId = generateUUIDv7();
    const success: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];

    await this.db.db.transaction(async (tx) => {
      // 1. 일괄 조회 with 행 잠금
      const invoices = await this.repository.findManyByIdsForUpdate(
        invoiceIds,
        tx,
      );

      // 2. 각 세금계산서 검증 및 처리
      for (const invoice of invoices) {
        try {
          // 상태 전이 가능 여부 확인
          if (!this.manager.canTransition(invoice.status, 'EXPORTED')) {
            failed.push({
              id: invoice.id,
              reason: `잘못된 상태: ${invoice.status} (REQUESTED 상태만 가능)`,
            });
            continue;
          }

          // 엑셀 내보내기 처리
          await this.manager.markAsExported(invoice, operator, batchId, tx);
          success.push(invoice.id);
        } catch (error) {
          failed.push({
            id: invoice.id,
            reason: error.message,
          });
        }
      }

      // 3. 조회되지 않은 ID 처리
      const foundIds = new Set(invoices.map((inv) => inv.id));
      for (const id of invoiceIds) {
        if (!foundIds.has(id)) {
          failed.push({
            id,
            reason: '세금계산서를 찾을 수 없습니다',
          });
        }
      }
    });

    const exportedAt = new Date();

    this.logger.log(
      `엑셀 내보내기 완료 - 성공: ${success.length}, 실패: ${failed.length}, 배치: ${batchId}`,
    );

    return {
      success,
      failed,
      batchId,
      exportedAt,
    };
  }

  /**
   * 발행 완료 처리
   * EXPORTED -> ISSUED_CONFIRMED
   */
  async confirmIssued(
    invoiceId: string,
    hometaxIssueNo: string,
    hometaxIssueDate: string,
    operator: string,
  ): Promise<void> {
    await this.db.db.transaction(async (tx) => {
      // 1. 조회 with 행 잠금
      const invoice = await this.repository.findByIdForUpdate(invoiceId, tx);

      if (!invoice) {
        throw new Error('세금계산서를 찾을 수 없습니다');
      }

      // 2. 발행 완료 처리
      await this.manager.confirmIssued(
        invoice,
        hometaxIssueNo,
        hometaxIssueDate,
        operator,
        tx,
      );
    });

    this.logger.log(`발행 완료 처리: ${invoiceId} - ${hometaxIssueNo}`);
  }

  /**
   * 발행 실패 처리
   * EXPORTED -> FAILED
   */
  async markFailed(
    invoiceId: string,
    failReason: string,
    errorCode: string | undefined,
    operator: string,
  ): Promise<void> {
    await this.db.db.transaction(async (tx) => {
      // 1. 조회 with 행 잠금
      const invoice = await this.repository.findByIdForUpdate(invoiceId, tx);

      if (!invoice) {
        throw new Error('세금계산서를 찾을 수 없습니다');
      }

      // 2. 실패 처리
      await this.manager.markAsFailed(
        invoice,
        failReason,
        errorCode,
        operator,
        tx,
      );
    });

    this.logger.log(`발행 실패 처리: ${invoiceId} - ${failReason}`);
  }

  /**
   * 취소 처리
   * REQUESTED -> CANCELLED
   */
  async cancel(
    invoiceId: string,
    cancelReason: string,
    operator: string,
  ): Promise<void> {
    await this.db.db.transaction(async (tx) => {
      // 1. 조회 with 행 잠금
      const invoice = await this.repository.findByIdForUpdate(invoiceId, tx);

      if (!invoice) {
        throw new Error('세금계산서를 찾을 수 없습니다');
      }

      // 2. 취소 처리
      await this.manager.cancel(invoice, cancelReason, operator, tx);
    });

    this.logger.log(`취소 처리: ${invoiceId} - ${cancelReason}`);
  }

  /**
   * 세금계산서 상세 조회
   */
  async getInvoiceById(invoiceId: string): Promise<TaxInvoice | null> {
    return await this.reader.findById(invoiceId);
  }

  /**
   * 홈택스 엑셀 Export용 데이터 조회
   * EXPORTED 상태의 세금계산서를 엑셀 포맷으로 변환
   */
  async getExportCandidates(params?: {
    fromDate?: string;
    toDate?: string;
    status?: string;
  }): Promise<HometaxExportRow[]> {
    // EXPORTED 상태의 세금계산서 조회
    const invoices = await this.reader.findAll({
      status: params?.status || 'EXPORTED',
      fromDate: params?.fromDate,
      toDate: params?.toDate,
      limit: 1000,
      offset: 0,
    });

    const exportRows: HometaxExportRow[] = [];

    for (const invoice of invoices) {
      // 스냅샷 조회
      const invoiceWithSnapshot = await this.reader.findWithSnapshot(
        invoice.id,
      );

      if (!invoiceWithSnapshot?.snapshot) {
        this.logger.warn(
          `Snapshot not found for invoice ${invoice.id}, skipping`,
        );
        continue;
      }

      const payload = invoiceWithSnapshot.snapshot
        .payload as TaxInvoiceSnapshotPayload;

      // 품목 요약 생성
      const productSummary = this.generateProductSummary(payload.order.lines);

      // Export Row 생성
      const row: HometaxExportRow = {
        taxInvoiceId: invoice.id,
        orderId: invoice.orderId,

        // 공급자 (우리 회사)
        supplierBusinessNumber: payload.supplier.businessNumber,
        supplierName: payload.supplier.name,
        supplierOwnerName: payload.supplier.ownerName,
        supplierAddress: payload.supplier.address,
        supplierBusinessType: payload.supplier.businessType,
        supplierBusinessItem: payload.supplier.businessItem,
        supplierEmail: payload.supplier.email,

        // 공급받는자 (고객)
        buyerBusinessNumber: payload.buyer.businessNumber,
        buyerName: payload.buyer.name,
        buyerOwnerName: payload.buyer.ownerName,
        buyerAddress: payload.buyer.address,
        buyerBusinessType: payload.buyer.businessType,
        buyerBusinessItem: payload.buyer.businessItem,
        buyerEmail: payload.buyer.email,

        // 거래 정보
        issueDate: payload.amounts.issueDate,
        supplyAmount: payload.amounts.supplyAmount,
        taxAmount: payload.amounts.taxAmount,
        totalAmount: payload.amounts.totalAmount,

        // 품목 요약
        productSummary,

        // 비고
        remark: payload.order.memo,

        // 결제수단
        paymentMethod: this.mapPaymentMethod(payload.order.paymentMethod),
      };

      exportRows.push(row);
    }

    this.logger.log(
      `Export candidates retrieved: ${exportRows.length} invoices`,
    );

    return exportRows;
  }

  /**
   * 품목 요약 생성
   */
  private generateProductSummary(
    lines: Array<{ productName: string; quantity: number }>,
  ): string {
    if (lines.length === 0) return '품목 없음';
    if (lines.length === 1) {
      return `${lines[0].productName} ${lines[0].quantity}개`;
    }
    return `${lines[0].productName} 외 ${lines.length - 1}건`;
  }

  /**
   * 결제수단 매핑
   */
  private mapPaymentMethod(method?: string): string {
    const methodMap: Record<string, string> = {
      CASH: '현금',
      CHECK: '수표',
      NOTE: '어음',
      CREDIT: '외상미수금',
      CARD: '신용카드',
    };
    return method ? methodMap[method] || method : '신용카드';
  }
}
