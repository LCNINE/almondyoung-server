import { Module } from '@nestjs/common';
import { DbModule } from '@app/db';
import { wmsTables } from '../../database/schemas/wms-schema';
import { ConfigModule } from '@nestjs/config';
import { BarcodeService } from './services/barcode.service';
import { WeightCalculatorService } from './services/weight-calculator.service';
import { FifoService } from './services/fifo.service';
import { TransactionService } from './services/transaction.service';
import { AuditService } from './services/audit.service';

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
    providers: [
        BarcodeService,
        WeightCalculatorService,
        FifoService,
        TransactionService,
        AuditService,
    ],
    exports: [
        BarcodeService,
        WeightCalculatorService,
        FifoService,
        TransactionService,
        AuditService,
    ],
})
export class SharedModule { }