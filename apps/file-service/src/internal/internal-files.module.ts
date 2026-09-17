import { Module } from '@nestjs/common';
import { INTERNAL_KEY_ENV } from '@app/authorization';
import { SharedModule } from '../shared/shared.module';
import { StorageModule } from '../storage/storage.module';
import { InternalFilesController } from './internal-files.controller';
import { InternalFilesService } from './internal-files.service';

@Module({
  imports: [SharedModule, StorageModule],
  controllers: [InternalFilesController],
  providers: [
    InternalFilesService,
    // InternalKeyGuard 가 읽을 env 이름.
    { provide: INTERNAL_KEY_ENV, useValue: 'FILE_SERVICE_INTERNAL_KEY' },
  ],
})
export class InternalFilesModule {}
