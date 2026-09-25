import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { DeliveryProfileController } from './controllers/delivery-profile.controller';
import { DeliveryProfileService } from './services/delivery-profile.service';
import { DeliveryProfileReader } from './services/delivery-profile.reader';
import { DeliveryProfileManager } from './services/delivery-profile.manager';

@Module({
  imports: [SharedModule],
  controllers: [DeliveryProfileController],
  providers: [DeliveryProfileService, DeliveryProfileReader, DeliveryProfileManager],
  exports: [DeliveryProfileService],
})
export class DeliveryProfileModule {}
