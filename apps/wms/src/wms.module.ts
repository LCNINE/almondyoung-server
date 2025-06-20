import { Module } from '@nestjs/common';
import { WmsController } from './wms.controller';
import { WmsService } from './wms.service';

@Module({
  imports: [],
  controllers: [WmsController],
  providers: [WmsService],
})
export class WmsModule {}
