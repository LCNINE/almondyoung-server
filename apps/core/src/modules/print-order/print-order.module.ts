import { Module } from '@nestjs/common';
import { StorePrintOrdersController } from './controllers/store-print-orders.controller';
import { WowpressCallbackController } from './controllers/wowpress-callback.controller';
import { CustomerPrintFileClient } from './clients/customer-print-file.client';
import { PrintFileRejectionManager } from './services/print-file-rejection.manager';
import { CustomerFileRejectionReader } from './services/customer-file-rejection.reader';
import { PrintFileReuploadManager } from './services/print-file-reupload.manager';
import { PrintCustomerFileReader } from './services/print-customer-file.reader';
import { StorePrintOrdersService } from './services/store-print-orders.service';
import { UgcAlmondDesignClient } from './clients/ugc-almond-design.client';
import { PrintProductSpecRepository } from './repositories/print-product-spec.repository';
import { PrintOrderAdminManager } from './services/print-order-admin.manager';
import { PrintOrderCancellationManager } from './services/print-order-cancellation.manager';
import { PrintOrderSubmitManager } from './services/print-order-submit.manager';
import { PrintOrderTrackingManager } from './services/print-order-tracking.manager';
import { PrintOrderReader } from './services/print-order.reader';
import { PrintOrderRepository } from './services/print-order.repository';
import { WowpressClient } from './wowpress/wowpress.client';
import { PrintOrderSubmitWorker } from './workers/print-order-submit.worker';
import { PrintOrderTrackingWorker } from './workers/print-order-tracking.worker';

@Module({
  controllers: [WowpressCallbackController, StorePrintOrdersController],
  providers: [
    PrintOrderRepository,
    PrintProductSpecRepository,
    PrintOrderSubmitManager,
    PrintOrderSubmitWorker,
    PrintOrderTrackingManager,
    PrintOrderTrackingWorker,
    PrintOrderReader,
    PrintOrderCancellationManager,
    PrintOrderAdminManager,
    WowpressClient,
    UgcAlmondDesignClient,
    CustomerPrintFileClient,
    PrintFileRejectionManager,
    PrintFileReuploadManager,
    CustomerFileRejectionReader,
    StorePrintOrdersService,
    PrintCustomerFileReader,
  ],
  exports: [
    WowpressClient,
    PrintOrderReader,
    PrintOrderCancellationManager,
    PrintOrderAdminManager,
    PrintProductSpecRepository,
    PrintCustomerFileReader,
  ],
})
export class PrintOrderModule {}
