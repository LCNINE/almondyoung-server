import { Module } from '@nestjs/common';
import { OrphanFileReaperService } from './orphan-file-reaper.service';
import { UploadedFileRepository } from './uploaded-file.repository';

@Module({
  providers: [UploadedFileRepository, OrphanFileReaperService],
  exports: [UploadedFileRepository],
})
export class FilesModule {}
