import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { pickingStrategyEnum } from '../../schema/inventory.schema';
import { CreateWarehouseDto } from './create-warehouse.dto';

export class UpdateWarehouseDto extends PartialType(CreateWarehouseDto) {
  /**
   * 이 창고가 지원하는 V2 피킹 전략. 배치 생성이 이 값을 게이트로 쓰므로
   * (outbound-batch-orchestrator.service.ts:107) 사실상 피킹 방식 개통 스위치다.
   * 빈 배열은 "이 창고로는 출고 배치를 만들 수 없다"는 유효한 상태다.
   *
   * CreateWarehouseDto 에는 일부러 넣지 않았다 — 신규 창고는 생성 후 수정으로 켠다.
   */
  @ApiPropertyOptional({
    description: '창고가 지원하는 V2 피킹 전략. 빈 배열이면 출고 배치를 만들 수 없다.',
    enum: pickingStrategyEnum.enumValues,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(pickingStrategyEnum.enumValues, { each: true })
  supportedPickingStrategies?: (typeof pickingStrategyEnum.enumValues)[number][];

  /**
   * 이 창고 재고가 storefront 판매가능수량에 들어가는지. 판정의 유일한 정의는
   * shared/availability/sellable-warehouses.ts 이고 이 컬럼이 그 입력이다.
   *
   * CreateWarehouseDto 에는 일부러 넣지 않았다 — 컬럼 DEFAULT 가 false 라 새 창고는
   * 비판매로 태어나고, 판매를 켜는 건 창고 설정 화면에서 명시적으로 한다. 반대 방향
   * (기본값 true + 나중에 끄기)은 중국 창고를 만든 순간 배 위의 재고가 팔린다.
   */
  @ApiPropertyOptional({
    description: '판매 창고 여부. false 면 이 창고 재고가 판매가능수량에서 빠진다.',
  })
  @IsOptional()
  @IsBoolean()
  isSellable?: boolean;
}
