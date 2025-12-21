import { Module } from '@nestjs/common';
import { UgcServiceController } from './ugc-service.controller';
import { UgcServiceService } from './ugc-service.service';

@Module({
  imports: [],
  controllers: [UgcServiceController],
  providers: [UgcServiceService],
})
export class UgcServiceModule {}
