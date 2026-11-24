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
export const PRINT_FILE_SAME_AS_REJECTED = 'PRINT_FILE_SAME_AS_REJECTED';
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
  // 거절 표시를 선점한 뒤 넘기고, 넘기지 못하면 표시를 되돌려 고객이 다시 올릴 수 있게 한다
  async reupload(customerId: string, salesOrderLineId: string, fileId: string): Promise<void> {
    const ctx = await this.repository.findLineContext(salesOrderLineId);
    if (!ctx || ctx.order.customerId !== customerId) {
      throw new NotFoundError('Print order not found');
    }

    const row = await this.repository.findBySalesOrderLineId(salesOrderLineId);
    if (!row) {
      throw new NotFoundError('Print order not found');
    }
    const { fileRejectedAt, vendorOrderNumber } = row;
    if (!fileRejectedAt || !row.printFileId || !vendorOrderNumber || !isTracked(row.status)) {
      throw new ConflictError(PRINT_FILE_NOT_REJECTED);
    }
    if (fileId === row.printFileId) {
      throw new BadRequestError(PRINT_FILE_SAME_AS_REJECTED);
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

    const claimedAt = await this.repository.claimReupload(row.id, fileRejectedAt);
    if (!claimedAt) {
      throw new ConflictError(PRINT_FILE_NOT_REJECTED);
    }

    try {
      const url = await this.customerFiles.link(fileId, customerId);
      await this.wowpress.uploadFileUrl(vendorOrderNumber, `${salesOrderLineId}.${extension}`, url);
    } catch (error) {
      this.logger.warn(`print order ${row.id} file reupload failed: ${errorMessage(error)}`);
      await this.repository.releaseReupload(row.id, claimedAt, fileRejectedAt);
      throw new ServiceUnavailableError(PRINT_FILE_DELIVERY_FAILED);
    }

    // 파일은 이미 와우프레스에 갔다. 더 새 기록이 있어 못 남긴 것이니 고객에게는 실패로 돌리지 않는다
    if (!(await this.repository.recordResubmittedFile(row.id, fileId, claimedAt))) {
      this.logger.warn(`print order ${row.id} took file ${fileId} but a newer reupload or rejection was recorded`);
    }
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
