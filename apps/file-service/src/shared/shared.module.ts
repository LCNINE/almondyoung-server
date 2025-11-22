import { Module } from '@nestjs/common';
import { FileRepository } from './repositories/file.repository';

@Module({
  providers: [FileRepository],
  exports: [FileRepository],
})
export class SharedModule {}

