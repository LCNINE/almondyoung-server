import { Module } from '@nestjs/common';
import { DownloadController } from './download.controller';
import { LocalFileController } from './local-file.controller';
import { DownloadService } from './download.service';
import { FileAccessModule } from '../access/file-access.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [FileAccessModule, StorageModule],
  // LocalFileController 는 STORAGE_PROVIDER=LOCAL 이 아니면 스스로 404 를 낸다 — 등록 자체를
  // 조건부로 만들면 부팅 순간의 env 에 배선이 묶여, 설정 실수가 "라우트가 아예 없음"으로 나타난다.
  controllers: [DownloadController, LocalFileController],
  providers: [DownloadService],
})
export class DownloadModule {}
