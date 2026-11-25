import { Injectable } from '@nestjs/common';
import { CustomerFileRejectionReader, type CustomerFileRejectionView } from './customer-file-rejection.reader';
import { PrintFileReuploadManager } from './print-file-reupload.manager';

@Injectable()
export class StorePrintOrdersService {
  constructor(
    private readonly rejections: CustomerFileRejectionReader,
    private readonly reupload: PrintFileReuploadManager,
  ) {}

  fileRejections(customerId: string): Promise<CustomerFileRejectionView[]> {
    return this.rejections.forCustomer(customerId);
  }

  reuploadFile(customerId: string, salesOrderLineId: string, fileId: string): Promise<void> {
    return this.reupload.reupload(customerId, salesOrderLineId, fileId);
  }
}
