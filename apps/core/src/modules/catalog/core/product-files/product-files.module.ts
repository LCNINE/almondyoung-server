import { Module } from '@nestjs/common';
import { INTERNAL_KEY_ENV } from '@app/authorization';
import { ProductFileReferencesService } from './product-file-references.service';
import { ProductFilesInternalController } from './product-files-internal.controller';

@Module({
  controllers: [ProductFilesInternalController],
  providers: [
    ProductFileReferencesService,
    // InternalKeyGuard 가 읽을 env 이름. core 의 서비스 간 호출은 이 키 하나를 쓴다.
    { provide: INTERNAL_KEY_ENV, useValue: 'CORE_INTERNAL_KEY' },
  ],
})
export class ProductFilesModule {}
