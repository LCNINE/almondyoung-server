import { Module } from '@nestjs/common';
import { PgIntegrationService } from './pg-integration.service';
import { PgIntegrationController } from './pg-integration.controller';
import { SharedModule } from '@app/shared';


@Module({
  imports: [SharedModule],
  controllers: [PgIntegrationController],
  providers: [PgIntegrationService],
  exports: [PgIntegrationService],
})
export class PgIntegrationModule {}