import { Module } from '@nestjs/common';

@Module({
  imports: [],
  controllers: [UploadController],
  providers: [UploadService],
})
export class UploadModule {}
