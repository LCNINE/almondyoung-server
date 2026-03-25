import { Module } from '@nestjs/common';
import { FileRepository } from './repositories/file.repository';
import { FileContextRepository } from './repositories/file-context.repository';
import { FileContextValidator } from './services/file-context-validator.service';
import { FileTypeDetector } from './services/file-type-detector.service';

@Module({
  providers: [FileRepository, FileContextRepository, FileContextValidator, FileTypeDetector],
  exports: [FileRepository, FileContextRepository, FileContextValidator, FileTypeDetector],
})
export class SharedModule {}
