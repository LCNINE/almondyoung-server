import { Module } from '@nestjs/common';
import { BeautytopShopsController } from './beautytop-shops.controller';
import { BeautytopShopsService } from './beautytop-shops.service';

@Module({
  controllers: [BeautytopShopsController],
  providers: [BeautytopShopsService],
})
export class BeautytopShopsModule {}
