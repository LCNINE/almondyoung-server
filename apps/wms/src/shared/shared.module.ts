import { Module } from '@nestjs/common';
import { DbModule } from '@app/db';
import { wmsTables } from '../../database/schemas/wms-schema';
import { ConfigModule } from '@nestjs/config';
import { BarcodeService } from './services/barcode.service';
import { WeightCalculatorService } from './services/weight-calculator.service';
import { FifoService } from './services/fifo.service';
import { TransactionService } from './services/transaction.service';
import { AuditService } from './services/audit.service';
import { MetricsService } from './services/metrics.service';
import { HealthService } from './services/health.service';
import { MetricsController } from './controllers/metrics.controller';
import { HealthController } from './controllers/health.controller';

@Module({
    imports: [
        ConfigModule.forRoot(),
        DbModule.forRoot({
            config: {
                connectionString: process.env.DATABASE_URL ?? '',
            },
            schema: wmsTables,
        }),
    ],
    controllers: [MetricsController, HealthController],
    providers: [
        BarcodeService,
        WeightCalculatorService,
        FifoService,
        TransactionService,
        AuditService,
        MetricsService,
        HealthService,
    ],
    exports: [
        BarcodeService,
        WeightCalculatorService,
        FifoService,
        TransactionService,
        AuditService,
        MetricsService,
        HealthService,
    ],
})
export class SharedModule { }