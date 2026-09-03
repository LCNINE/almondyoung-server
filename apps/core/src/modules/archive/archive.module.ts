import { Module } from '@nestjs/common';

import { ArchiveController } from './archive.controller';
import { ArchiveManager } from './archive.manager';
import { ArchiveReader } from './archive.reader';
import { ArchiveService } from './archive.service';

@Module({
  controllers: [ArchiveController],
  providers: [ArchiveService, ArchiveReader, ArchiveManager],
  exports: [ArchiveService],
})
export class ArchiveModule {}
