import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FileController } from './file.controller';
import { FileService } from './file.service';

@Module({
  imports: [],
  controllers: [FileController],
  providers: [FileService],
  exports: [FileService],
})
export class FileModule {}
