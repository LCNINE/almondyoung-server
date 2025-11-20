import { Injectable } from '@nestjs/common';
import { TaxInvoiceRepository } from './tax-invoice.repository';
import { TaxInvoiceSnapshotRepository } from './tax-invoice-snapshot.repository';
import { TaxInvoiceEventRepository } from './tax-invoice-event.repository';
import type {
  TaxInvoice,
  TaxInvoiceSnapshot,
  TaxInvoiceEvent,
  TaxInvoiceWithSnapshot,
  TaxInvoiceWithEvents,
} from '../../shared/database/types';
import type { WalletExecutor } from '../../shared/database';

/**
 * TaxInvoiceReader - 세금계산서 조회 (Implementation Layer)
 *
 * 책임: Service와 Repository 사이의 레이어 (조회 전담)
 */
@Injectable()
export class TaxInvoiceReader {
  constructor(
    private readonly taxInvoiceRepo: TaxInvoiceRepository,
    private readonly snapshotRepo: TaxInvoiceSnapshotRepository,
    private readonly eventRepo: TaxInvoiceEventRepository,
  ) {}

  /**
   * ID로 세금계산서 조회
   */
  async findById(
    invoiceId: string,
    tx?: WalletExecutor,
  ): Promise<TaxInvoice | null> {
    return await this.taxInvoiceRepo.findById(invoiceId, tx);
  }

  /**
   * ID로 세금계산서 조회 (없으면 에러)
   */
  async findByIdOrFail(
    invoiceId: string,
    tx?: WalletExecutor,
  ): Promise<TaxInvoice> {
    const invoice = await this.taxInvoiceRepo.findById(invoiceId, tx);
    if (!invoice) throw new Error('Tax invoice not found');
    return invoice;
  }

  /**
   * 주문 ID로 세금계산서 조회
   */
  async findByOrderId(
    orderId: string,
    tx?: WalletExecutor,
  ): Promise<TaxInvoice | null> {
    return await this.taxInvoiceRepo.findByOrderId(orderId, tx);
  }

  /**
   * 세금계산서 + 스냅샷 조회
   */
  async findWithSnapshot(
    invoiceId: string,
    tx?: WalletExecutor,
  ): Promise<TaxInvoiceWithSnapshot | null> {
    const invoice = await this.taxInvoiceRepo.findById(invoiceId, tx);
    if (!invoice) return null;

    const snapshot = await this.snapshotRepo.findByInvoiceId(invoiceId, tx);

    return {
      ...invoice,
      snapshot: snapshot ?? undefined,
    };
  }

  /**
   * 세금계산서 + 이벤트 조회
   */
  async findWithEvents(
    invoiceId: string,
    tx?: WalletExecutor,
  ): Promise<TaxInvoiceWithEvents | null> {
    const invoice = await this.taxInvoiceRepo.findById(invoiceId, tx);
    if (!invoice) return null;

    const events = await this.eventRepo.findByInvoiceId(invoiceId, tx);

    return {
      ...invoice,
      events,
    };
  }

  /**
   * 스냅샷 조회
   */
  async findSnapshot(
    invoiceId: string,
    tx?: WalletExecutor,
  ): Promise<TaxInvoiceSnapshot | null> {
    return await this.snapshotRepo.findByInvoiceId(invoiceId, tx);
  }

  /**
   * 이벤트 목록 조회
   */
  async findEvents(
    invoiceId: string,
    tx?: WalletExecutor,
  ): Promise<TaxInvoiceEvent[]> {
    return await this.eventRepo.findByInvoiceId(invoiceId, tx);
  }

  /**
   * 사용자별 세금계산서 목록 조회
   */
  async findByUserId(params: {
    userId: string;
    status?: string;
    fromDate?: string;
    toDate?: string;
    limit: number;
    offset: number;
  }): Promise<TaxInvoice[]> {
    return await this.taxInvoiceRepo.findByUserId(params);
  }

  /**
   * 관리자용 세금계산서 목록 조회
   */
  async findAll(params: {
    status?: string;
    userId?: string;
    fromDate?: string;
    toDate?: string;
    limit: number;
    offset: number;
  }): Promise<TaxInvoice[]> {
    return await this.taxInvoiceRepo.findAll(params);
  }

  /**
   * 발행 대기 중인 세금계산서 목록 조회
   */
  async findRequested(limit: number, offset: number): Promise<TaxInvoice[]> {
    return await this.taxInvoiceRepo.findRequested(limit, offset);
  }
}

