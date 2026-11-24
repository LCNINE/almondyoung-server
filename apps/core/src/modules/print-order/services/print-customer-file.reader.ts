import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@app/shared';
import { CustomerPrintFileClient, CustomerPrintFileNotFoundError } from '../clients/customer-print-file.client';
import { PrintOrderRepository } from './print-order.repository';

export interface PrintCustomerFileLink {
  url: string;
}

// 내 파일로 주문한 인쇄 줄의 고객 파일. 운영자가 CS 로 파일을 직접 볼 때 쓴다
@Injectable()
export class PrintCustomerFileReader {
  constructor(
    private readonly repository: PrintOrderRepository,
    private readonly customerFiles: CustomerPrintFileClient,
  ) {}

  async link(printOrderId: string): Promise<PrintCustomerFileLink> {
    const row = await this.repository.findById(printOrderId);
    const ctx = row?.printFileId ? await this.repository.findLineContext(row.salesOrderLineId) : null;
    const customerId = ctx?.order.customerId;
    if (!row?.printFileId || !customerId) {
      throw new NotFoundError(`Customer print file not found for print order: ${printOrderId}`);
    }

    try {
      // 파일 주인(주문 고객)을 대신해 읽는다. 받으면 원래 파일 이름으로 저장된다
      return { url: await this.customerFiles.downloadLink(row.printFileId, customerId) };
    } catch (error) {
      if (error instanceof CustomerPrintFileNotFoundError) {
        throw new NotFoundError(`Customer print file is gone: ${row.printFileId}`);
      }

      throw error;
    }
  }
}
