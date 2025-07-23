import { Module } from '@nestjs/common';
import { DbModule } from '@app/db';
import { wmsTables } from '../../database/schemas/wms-schema';
import { ConfigModule } from '@nestjs/config';
import { InventoryModule } from '../inventory/inventory.module';
import { SharedModule } from '../shared/shared.module';
import { ReturnController } from './controllers/return.controller';
import { ReturnService } from './services/return.service';

@Module({
    imports: [
        ConfigModule.forRoot(),
        DbModule.forRoot({
            config: {
                connectionString: process.env.DATABASE_URL ?? '',
            },
            schema: wmsTables,
        }),
        InventoryModule,
        SharedModule,
    ],
    controllers: [ReturnController],
    providers: [ReturnService],
    exports: [ReturnService],
})
export class ReturnModule { }