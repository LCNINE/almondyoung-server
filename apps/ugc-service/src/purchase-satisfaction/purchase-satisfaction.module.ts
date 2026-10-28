import { Module } from '@nestjs/common';
import { AdminPurchaseSatisfactionController } from './controllers/admin-purchase-satisfaction.controller';
import { InternalPurchaseSatisfactionController } from './controllers/internal-purchase-satisfaction.controller';
import { PurchaseSatisfactionManager } from './purchase-satisfaction.manager';
import { PurchaseSatisfactionReader } from './purchase-satisfaction.reader';
import { PurchaseSatisfactionService } from './purchase-satisfaction.service';

@Module({
  controllers: [AdminPurchaseSatisfactionController, InternalPurchaseSatisfactionController],
  providers: [PurchaseSatisfactionService, PurchaseSatisfactionManager, PurchaseSatisfactionReader],
})
export class PurchaseSatisfactionModule {}
