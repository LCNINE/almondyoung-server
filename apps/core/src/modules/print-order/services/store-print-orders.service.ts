import { Injectable } from '@nestjs/common';
import { PrintFileReuploadManager } from './print-file-reupload.manager';
import { PrintOrderReader, type CustomerFileRejection } from './print-order.reader';

@Injectable()
export class StorePrintOrdersService {
  constructor(
    private readonly reader: PrintOrderReader,
    private readonly reupload: PrintFileReuploadManager,
  ) {}

  fileRejections(customerId: string): Promise<CustomerFileRejection[]> {
    return this.reader.customerFileRejections(customerId);
  }

  reuploadFile(customerId: string, salesOrderLineId: string, fileId: string): Promise<void> {
    return this.reupload.reupload(customerId, salesOrderLineId, fileId);
  }
}
