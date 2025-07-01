import { Module } from '@nestjs/common';
import { WmsController } from './wms.controller';
import { WmsService } from './wms.service';
import { ExampleModule } from './example/example.module';

@Module({
  imports: [ExampleModule],
  controllers: [WmsController],
  providers: [WmsService],
})
export class WmsModule {}
