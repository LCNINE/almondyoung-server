import { Module } from '@nestjs/common';
import { CoreInventoryModule } from '../core/inventory.module';
import { SkuCatalogModule } from '../sku-catalog/sku-catalog.module';
import { SharedModule } from '../shared/shared.module';
import { InboundController } from './controllers/inbound.controllers';
import { InboundService } from './services/inbound.service';
import { InboundPutawayReader } from './services/inbound-putaway.reader';

@Module({
  imports: [CoreInventoryModule, SkuCatalogModule, SharedModule],
  controllers: [InboundController],
  providers: [InboundService, InboundPutawayReader],
  exports: [InboundService],
})
export class InboundModule {}
