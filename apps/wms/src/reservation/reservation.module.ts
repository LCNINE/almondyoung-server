// apps/wms/src/reservation/reservation.module.ts
import { Module } from '@nestjs/common';
import { DbModule } from '@app/db';
import { wmsTables } from '../../database/schemas/wms-schema';
import { ConfigModule } from '@nestjs/config';
import { InventoryModule } from '../inventory/inventory.module';
import { SharedModule } from '../shared/shared.module';
import { OrderCollectController } from './controllers/order-collect.controller';
import { ReservationController } from './controllers/reservation.controller';
import { OrderCollectService } from './services/order-collect.service';
import { ReservationService } from './services/reservation.service';
import { BasketService } from './services/basket.service';

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
    controllers: [OrderCollectController, ReservationController],
    providers: [OrderCollectService, ReservationService, BasketService],
    exports: [OrderCollectService, ReservationService, BasketService],
})
export class ReservationModule { }