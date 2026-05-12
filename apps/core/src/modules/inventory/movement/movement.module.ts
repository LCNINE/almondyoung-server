import { Module } from '@nestjs/common';
import { CoreInventoryModule } from '../core/inventory.module';
import { SharedModule } from '../shared/shared.module';
import { MovementController } from './controllers/movement.controller';
import { MovementService } from './services/movement.service';

@Module({
  imports: [CoreInventoryModule, SharedModule],
  controllers: [MovementController],
  providers: [MovementService],
  exports: [MovementService],
})
export class MovementModule {}
