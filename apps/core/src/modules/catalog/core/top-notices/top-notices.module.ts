import { Module } from '@nestjs/common';
import { TopNoticesController } from './top-notices.controller';
import { TopNoticesService } from './top-notices.service';
import { TopNoticeManager } from './top-notice.manager';
import { TopNoticeReader } from './top-notice.reader';

@Module({
  controllers: [TopNoticesController],
  providers: [TopNoticesService, TopNoticeReader, TopNoticeManager],
  exports: [TopNoticesService],
})
export class TopNoticesModule {}
