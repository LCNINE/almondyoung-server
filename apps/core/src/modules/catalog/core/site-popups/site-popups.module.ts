import { Module } from '@nestjs/common';
import { SitePopupsController } from './site-popups.controller';
import { SitePopupsService } from './site-popups.service';
import { SitePopupManager } from './site-popup.manager';
import { SitePopupReader } from './site-popup.reader';

@Module({
  controllers: [SitePopupsController],
  providers: [SitePopupsService, SitePopupReader, SitePopupManager],
  exports: [SitePopupsService],
})
export class SitePopupsModule {}
