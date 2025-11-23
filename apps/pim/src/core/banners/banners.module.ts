import { Module } from '@nestjs/common';
import { BannersService } from './banners.service';
import { BannerGroupsController } from './banner-groups.controller';
import { BannersController } from './banners.controller';

@Module({
  controllers: [BannerGroupsController, BannersController],
  providers: [BannersService],
  exports: [BannersService],
})
export class BannersModule {}

