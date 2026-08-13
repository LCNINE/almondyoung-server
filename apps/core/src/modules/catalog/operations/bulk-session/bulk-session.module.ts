import { Module } from '@nestjs/common';
import { FormExportController } from './form-export.controller';
import { BulkSessionController } from './bulk-session.controller';
import { FormExportService } from './services/form-export.service';
import { FormExportManager } from './services/form-export.manager';
import { FormExportSnapshotReader } from './services/form-export.snapshot.reader';
import { FormExportBlankBuilder } from './services/form-export.blank';
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
import { BulkSessionComboResolver } from './services/bulk-session.combos';
import { BulkVariantCodeChecker } from './services/bulk-variant-code.checker';
import { BulkDuplicateNameChecker } from './services/bulk-duplicate-name.checker';
import { BulkSessionCleaner } from './services/bulk-session.cleaner';
import { ProductsModule } from '../../core/products/products.module';
import { PricingModule } from '../../core/pricing/pricing.module';
import { CategoriesModule } from '../../core/categories/categories.module';
import { ProductMatchingModule } from '../../../product-matching/product-matching.module';

// FormExportSnapshotReader 는 FormExportService(접수·조회)가 직접 쓰진 않지만, Task 5
// 산출물이 아직 어떤 모듈에도 물려 있지 않아 DI 그래프 검증이 안 된 상태였다 — 여기서
// 같이 등록해 ProductVersionReadLoader/OptionReadLoader/PricingService/
// ProductCategoriesService 4개 의존성이 실제로 해석되는지 부트 검증한다(ProductsModule
// 이 ProductVersionReadLoader 를 export 하지 않아 막혀 있던 것을 그 커밋에서 함께
// 고쳤다 — products.module.ts 참조). (Task 3) 프리필이 품목 판매정책을 채우려면 화면과
// 같은 ProductSkuMappingService(product-matching BC)가 다섯 번째 의존성으로 필요하다 —
// 그래서 ProductMatchingModule 을 imports 에 더한다. products.module.ts 가 같은 모듈을
// forwardRef 로 감싸는 건 ProductsModule 자신이 product-matching 서비스를 직접
// 주입받기 때문이고(순환), 여기 BulkSessionModule 은 그 방향의 순환이 없어 그냥
// import 한다.
// FormExportJobManager/FormExportJobWorker 는
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
// BulkSessionComboResolver 는 (Task 7) 조합키(수정 행의 idKey / 신규 행의 워크북 이름 키) →
// variantId 해석기다. 원래 BulkDraftApplier 의 private 메서드였는데, 발행 경로(Task 8)가
// 같은 해석을 다시 써야 해서 공용 모듈로 뽑았다 — BulkDraftApplier 가 생성자로 주입받는다.
// BulkSessionCleaner 는 5단계 종단 세션 워크북 정리 @Cron 스윕이다(BulkImageCleaner 와는
// 다른 대상 — 취소 세션 이미지가 아니라 발행 완료·취소 세션이 남긴 원본 엑셀). 다른 크론
// provider 들과 같은 이유로 등록해야 ScheduleExplorer 가 마운트한다.
// BulkVariantCodeChecker 는 검증 레인이 review 로 넘기기 직전에 부르는 세션 전역 variantCode
// 중복 사전검사다(Task 11). 크론이 아니라 BulkSessionJobManager 가 생성자 DI 로 직접
// 물기 때문에, 등록을 빠뜨리면 (다른 provider 들처럼 조용히 무해한 게 아니라) 부팅 자체가
// UnknownDependenciesException 으로 죽는다.
// BulkDuplicateNameChecker 는 같은 자리에서 도는 신규 행 상품명 중복 사전검사다(이슈 #630) —
// 등록 누락 시 부팅이 죽는 것도 같다.
@Module({
  imports: [ProductsModule, PricingModule, CategoriesModule, ProductMatchingModule],
  controllers: [FormExportController, BulkSessionController],
  providers: [
    FormExportService,
    FormExportManager,
    FormExportSnapshotReader,
    FormExportBlankBuilder,
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
    BulkSessionComboResolver,
    BulkVariantCodeChecker,
    BulkDuplicateNameChecker,
    BulkSessionCleaner,
  ],
  exports: [FormExportService],
})
export class BulkSessionModule {}
