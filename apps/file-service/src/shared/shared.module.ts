import { Module } from '@nestjs/common';
import { FileRepository } from './repositories/file.repository';
import { FileContextRepository } from './repositories/file-context.repository';
import { FileContextValidator } from './services/file-context-validator.service';

@Module({
  providers: [FileRepository, FileContextRepository, FileContextValidator],
  exports: [FileRepository, FileContextRepository, FileContextValidator],
})
export class SharedModule {}

