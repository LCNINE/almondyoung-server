import { Module } from '@nestjs/common';
import { CardMethodController } from './card-method.controller';
import { CardMethodService } from './card-method.service';
import { CardMethodStrategy } from './strategies/card-method.strategy';
import { HmsApiProvider } from '../payment-method/hms-provider';

@Module({
  imports: [],
  controllers: [CardMethodController],
  providers: [
    CardMethodService,
    CardMethodStrategy,
    HmsApiProvider, // 기본 HMS API
  ],
  exports: [CardMethodService, HmsApiProvider],
})
export class CardMethodModule {}
