import { Module } from '@nestjs/common';
import { FormExportController } from './form-export.controller';
import { BulkSessionController } from './bulk-session.controller';
import { FormExportService } from './services/form-export.service';
import { FormExportManager } from './services/form-export.manager';
import { FormExportSnapshotReader } from './services/form-export.snapshot.reader';
import { FormExportFileClient } from './services/form-export-file.client';
import { FormExportJobManager } from './services/form-export-job.manager';
import { FormExportJobWorker } from './services/form-export-job.worker';
import { BulkSessionService } from './services/bulk-session.service';
import { BulkSessionManager } from './services/bulk-session.manager';
import { BulkSessionReader } from './services/bulk-session.reader';
import { BulkSessionJobManager } from './services/bulk-session-job.manager';
import { BulkSessionJobWorker } from './services/bulk-session-job.worker';
import { BulkImageManager } from './services/bulk-image.manager';
import { BulkImageCleaner } from './services/bulk-image.cleaner';
import { BulkDraftApplier } from './services/bulk-draft.applier';
import { ProductsModule } from '../../core/products/products.module';
import { PricingModule } from '../../core/pricing/pricing.module';
import { CategoriesModule } from '../../core/categories/categories.module';

// FormExportSnapshotReader 는 FormExportService(접수·조회)가 직접 쓰진 않지만, Task 5
// 산출물이 아직 어떤 모듈에도 물려 있지 않아 DI 그래프 검증이 안 된 상태였다 — 여기서
// 같이 등록해 ProductVersionReadLoader/OptionReadLoader/PricingService/
// ProductCategoriesService 4개 의존성이 실제로 해석되는지 부트 검증한다(ProductsModule
// 이 ProductVersionReadLoader 를 export 하지 않아 막혀 있던 것을 그 커밋에서 함께
// 고쳤다 — products.module.ts 참조). FormExportJobManager/FormExportJobWorker 는
// 앞선 커밋(양식 조립 워커) 산출물이다 — 워커는 `@Cron` 데코레이터만으로는 아무 것도
// 하지 않는다. Nest 컨테이너의 provider 로 등록돼야 (전역으로 이미 떠 있는)
// ScheduleModule 의 ScheduleExplorer 가 discovery 로 찾아 크론에 마운트한다.
// BulkSessionController/Service/Manager/Reader 는 업로드 접수 + 조회·결정·승인·취소
// 경로(Task 10)다. BulkSessionManager 가 이제 BulkSessionReader 도 주입받으므로(승인·취소가
// 진행률 응답을 그대로 재사용한다) Reader 도 여기 provider 로 등록해야 한다.
// BulkSessionJobManager/BulkSessionJobWorker 는 검증 레인이다 — 워커도 같은 이유로
// provider 로 등록돼야 ScheduleExplorer 가 `@Cron` 을 찾아 마운트한다.
// BulkImageManager 는 3단계 이미지 해석 통보 경로다. BulkSessionReader 를 주입받아
// 전량 게이트 술어와 진행률을 승인 경로와 **공유**한다 — 복사본을 만들면 승인과 게이트가
// 서로 다른 답을 내는 자리가 생긴다.
// BulkImageCleaner 는 취소된 세션이 올린 파일을 지우는 @Cron 스윕이다. 워커와 마찬가지로
// provider 로 등록돼야 (전역으로 이미 떠 있는) ScheduleModule 의 explorer 가 크론에 마운트한다.
// BulkDraftApplier 는 4단계 draft 생성 경로다. catalog core 의 쓰기 서비스 여섯을 주입받아
// 조립만 하므로 자체 DB 접근은 잠금 UPDATE 한 문장뿐이다.
@Module({
  imports: [ProductsModule, PricingModule, CategoriesModule],
  controllers: [FormExportController, BulkSessionController],
  providers: [
    FormExportService,
    FormExportManager,
    FormExportSnapshotReader,
    FormExportFileClient,
    FormExportJobManager,
    FormExportJobWorker,
    BulkSessionService,
    BulkSessionManager,
    BulkSessionReader,
    BulkSessionJobManager,
    BulkSessionJobWorker,
    BulkImageManager,
    BulkImageCleaner,
    BulkDraftApplier,
  ],
  exports: [FormExportService],
})
export class BulkSessionModule {}
