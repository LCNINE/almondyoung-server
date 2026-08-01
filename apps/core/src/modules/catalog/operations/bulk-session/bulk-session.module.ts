import { Module } from '@nestjs/common';
import { FormExportController } from './form-export.controller';
import { FormExportService } from './services/form-export.service';
import { FormExportManager } from './services/form-export.manager';
import { FormExportSnapshotReader } from './services/form-export.snapshot.reader';
import { FormExportFileClient } from './services/form-export-file.client';
import { FormExportJobManager } from './services/form-export-job.manager';
import { FormExportJobWorker } from './services/form-export-job.worker';
import { ProductsModule } from '../../core/products/products.module';
import { PricingModule } from '../../core/pricing/pricing.module';
import { CategoriesModule } from '../../core/categories/categories.module';

// FormExportSnapshotReader 는 FormExportService(접수·조회)가 직접 쓰진 않지만, Task 5
// 산출물이 아직 어떤 모듈에도 물려 있지 않아 DI 그래프 검증이 안 된 상태였다 — 여기서
// 같이 등록해 ProductVersionReadLoader/OptionReadLoader/PricingService/
// ProductCategoriesService 4개 의존성이 실제로 해석되는지 부트 검증한다(ProductsModule
// 이 ProductVersionReadLoader 를 export 하지 않아 막혀 있던 것을 그 커밋에서 함께
// 고쳤다 — products.module.ts 참조). FormExportJobManager/FormExportJobWorker 는
// Task 8 산출물이다 — 워커는 `@Cron` 데코레이터만으로는 아무 것도 하지 않는다. Nest
// 컨테이너의 provider 로 등록돼야 (전역으로 이미 떠 있는) ScheduleModule 의
// ScheduleExplorer 가 discovery 로 찾아 크론에 마운트한다.
@Module({
  imports: [ProductsModule, PricingModule, CategoriesModule],
  controllers: [FormExportController],
  providers: [
    FormExportService,
    FormExportManager,
    FormExportSnapshotReader,
    FormExportFileClient,
    FormExportJobManager,
    FormExportJobWorker,
  ],
  exports: [FormExportService],
})
export class BulkSessionModule {}
