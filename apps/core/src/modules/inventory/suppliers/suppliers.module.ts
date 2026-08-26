import { Module } from '@nestjs/common';
import { SuppliersController } from './controllers/suppliers.controller';
import { SupplierCategoriesController } from './controllers/supplier-categories.controller';
import { SuppliersService } from './services/suppliers.service';
import { SupplierCategoriesService } from './services/supplier-categories.service';

/**
 * 공급처 마스터데이터. **`procurement/` 아래가 아니라 형제로 둔다.**
 *
 * #724 항목 5 는 원래 이 모듈을 `procurement/` 로 옮기려 했으나, 착수 시점 실측이
 * 그 전제("공급처는 발주 전용")를 반박했다 — 소비자가 셋이고 둘이 조달 밖이다:
 *
 * - `procurement/services/purchase-order.service.ts` — `SupplierResponseDto` (같은 도메인)
 * - `inbound/services/inbound.service.ts:435` · `inbound/dto/simple-inbound.dto.ts:296`
 *   — 입고 계획 응답에 연계 발주의 공급처를 싣는다
 * - `catalog/operations/export/product-export.module.ts:5` — `SuppliersModule` 자체를
 *   import 한다 (런타임 모듈 의존, 상품 내보내기가 공급처명을 쓴다)
 *
 * `procurement/` 아래로 내리면 `inbound → procurement` · `catalog → procurement` 의존이
 * 생겨 ADR-0032 결정 4(세 모듈은 포트로만 만난다)와 어긋난다. 공급처는 조달의 부품이
 * 아니라 `sku-catalog` · `warehouse` 와 같은 층의 **마스터데이터**이므로 형제가 맞다.
 *
 * ⚠️ 이 모듈의 §1.7 계층 정렬(Controller → Service → Reader/Manager)은 아직 안 됐다 — #745.
 */
@Module({
  imports: [],
  controllers: [SuppliersController, SupplierCategoriesController],
  providers: [SuppliersService, SupplierCategoriesService],
  exports: [SuppliersService, SupplierCategoriesService],
})
export class SuppliersModule {}
