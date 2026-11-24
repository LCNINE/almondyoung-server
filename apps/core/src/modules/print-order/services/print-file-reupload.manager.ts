import { Injectable, Logger } from '@nestjs/common';
import { BadRequestError, ConflictError, NotFoundError, ServiceUnavailableError } from '@app/shared';
import {
  CustomerPrintFileClient,
  CustomerPrintFileNotFoundError,
  type CustomerPrintFile,
} from '../clients/customer-print-file.client';
import { customerFileExtension } from '../print-source';
import { type PrintOrderStatus } from '../schema/print-order.schema';
import { PrintProductSpecRepository } from '../repositories/print-product-spec.repository';
import { WowpressClient } from '../wowpress/wowpress.client';
import { WOWPRESS_PRODUCTS } from '../wowpress/wowpress-products';
import { PrintOrderRepository } from './print-order.repository';

// 스토어프론트가 이 문구로 안내를 고른다
export const PRINT_FILE_NOT_YOURS = 'PRINT_FILE_NOT_YOURS';
export const PRINT_FILE_TYPE_NOT_ACCEPTED = 'PRINT_FILE_TYPE_NOT_ACCEPTED';
export const PRINT_FILE_NOT_REJECTED = 'PRINT_FILE_NOT_REJECTED';
export const PRINT_FILE_DELIVERY_FAILED = 'PRINT_FILE_DELIVERY_FAILED';

const isTracked = (status: PrintOrderStatus): boolean => status === 'submitted' || status === 'shipped';

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

@Injectable()
export class PrintFileReuploadManager {
  private readonly logger = new Logger(PrintFileReuploadManager.name);

  constructor(
    private readonly repository: PrintOrderRepository,
    private readonly specs: PrintProductSpecRepository,
    private readonly customerFiles: CustomerPrintFileClient,
    private readonly wowpress: WowpressClient,
  ) {}

  // 와우프레스가 파일 에러로 돌려보낸 고객 파일 줄에 새 파일을 같은 주문번호로 다시 넘긴다(와우프레스는 재접수로 받는다).
  // 줄을 잠근 채 상태를 다시 보고 넘긴 뒤에만 기록한다. 중간에 멈추면 에러 표시가 그대로 남아 고객이 다시 올릴 수 있다
  async reupload(customerId: string, salesOrderLineId: string, fileId: string): Promise<void> {
    const ctx = await this.repository.findLineContext(salesOrderLineId);
    if (!ctx || ctx.order.customerId !== customerId) {
      throw new NotFoundError('Print order not found');
    }

    const spec = (await this.specs.findSpec(ctx.line.variantId)) ?? WOWPRESS_PRODUCTS[ctx.line.variantId];
    const file = await this.describe(fileId, customerId);
    if (file.ownerId !== customerId || !file.isPrintFile) {
      throw new BadRequestError(PRINT_FILE_NOT_YOURS);
    }
    const extension = spec ? customerFileExtension(spec.prodno, file.fileName) : null;
    if (!extension) {
      throw new BadRequestError(PRINT_FILE_TYPE_NOT_ACCEPTED);
    }

    await this.repository.withLockedLine(salesOrderLineId, async (row, tx) => {
      if (!row) {
        throw new NotFoundError('Print order not found');
      }
      if (!row.fileRejectedAt || !row.printFileId || !row.vendorOrderNumber || !isTracked(row.status)) {
        throw new ConflictError(PRINT_FILE_NOT_REJECTED);
      }

      try {
        const url = await this.customerFiles.link(fileId, customerId);
        await this.wowpress.uploadFileUrl(row.vendorOrderNumber, `${salesOrderLineId}.${extension}`, url);
      } catch (error) {
        this.logger.warn(`print order ${row.id} file reupload failed: ${errorMessage(error)}`);
        throw new ServiceUnavailableError(PRINT_FILE_DELIVERY_FAILED);
      }

      if (!(await this.repository.recordResubmittedFile(row.id, fileId, tx))) {
        throw new Error(`print order ${row.id} took a new file but could not record it`);
      }
    });
  }

  private async describe(fileId: string, customerId: string): Promise<CustomerPrintFile> {
    try {
      return await this.customerFiles.describe(fileId, customerId);
    } catch (error) {
      if (error instanceof CustomerPrintFileNotFoundError) {
        throw new BadRequestError(PRINT_FILE_NOT_YOURS);
      }
      this.logger.warn(`print file ${fileId} lookup failed: ${errorMessage(error)}`);
      throw new ServiceUnavailableError(PRINT_FILE_DELIVERY_FAILED);
    }
  }
}
