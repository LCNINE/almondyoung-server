import { Module } from '@nestjs/common';
import { BarcodeService } from './services/barcode.service';
import { FifoService } from './services/fifo.service';
import { TransactionService } from './services/transaction.service';
import { AuditService } from './services/audit.service';
import { MetricsService } from './services/metrics.service';
import { HealthService } from './services/health.service';
// import { StockAvailabilityService } from './services/stock-availability.service';
import { UnifiedReservationService } from './services/unified-reservation.service';
import { ReservationLifecycleService } from './services/reservation-lifecycle.service';
import { MetricsController } from './controllers/metrics.controller';
import { HealthController } from './controllers/health.controller';
import { BarcodeGenerationController } from './controllers/barcode-generation.controller';
import { ProductSellableQuantityModule } from '../product-sellable-quantity/product-sellable-quantity.module';

@Module({
  imports: [ProductSellableQuantityModule],
  controllers: [MetricsController, HealthController, BarcodeGenerationController],
  providers: [
    BarcodeService,
    FifoService,
    TransactionService,
    AuditService,
    MetricsService,
    HealthService,
    // StockAvailabilityService,
    UnifiedReservationService,
    ReservationLifecycleService,
  ],
  exports: [
    BarcodeService,
    FifoService,
    TransactionService,
    AuditService,
    MetricsService,
    HealthService,
    // StockAvailabilityService,
    UnifiedReservationService,
    ReservationLifecycleService,
  ],
})
export class SharedModule {}
