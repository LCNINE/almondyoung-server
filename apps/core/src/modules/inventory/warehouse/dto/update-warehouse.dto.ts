import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsEnum, IsOptional } from 'class-validator';
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
}
