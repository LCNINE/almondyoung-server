import { Module } from '@nestjs/common';
import { UgcAlmondDesignClient } from './clients/ugc-almond-design.client';
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
  providers: [
    PrintOrderRepository,
    PrintOrderSubmitManager,
    PrintOrderSubmitWorker,
    PrintOrderTrackingManager,
    PrintOrderTrackingWorker,
    PrintOrderReader,
    PrintOrderCancellationManager,
    PrintOrderAdminManager,
    WowpressClient,
    UgcAlmondDesignClient,
  ],
  exports: [PrintOrderReader, PrintOrderCancellationManager, PrintOrderAdminManager],
})
export class PrintOrderModule {}
