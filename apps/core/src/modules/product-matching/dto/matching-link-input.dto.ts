import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  Min,
  ValidateIf,
  ValidateNested,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  isUUID,
} from 'class-validator';
import { CreateSkuDto } from '../../inventory/sku-catalog/dto/create-sku.dto';

/**
 * skuId 와 newSku 는 정확히 하나여야 한다.
 *
 * `@IsOptional()` 은 값이 undefined 면 그 프로퍼티의 검증기를 전부 건너뛰므로
 * 「둘 다 없음」을 데코레이터 조합으로는 잡을 수 없다. 배타성과 UUID 형식을
 * 한 검증기 안에서 함께 판정한다.
 */
@ValidatorConstraint({ name: 'matchingSkuRef', async: false })
export class MatchingSkuRefConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const link = args.object as MatchingLinkInputDto;
    const hasSkuId = link.skuId !== undefined && link.skuId !== null;
    const hasNewSku = link.newSku !== undefined && link.newSku !== null;

    if (hasSkuId === hasNewSku) return false;
    // 'loose' — 8-4-4-4-12 16진수 그룹만 확인한다. 기본값('all')은 RFC4122 variant
    // 니블([89ab])까지 요구해서, 테스트 픽스처('...-4444-...')처럼 그 자리가
    // 4인 값까지 스키마-형식 위반으로 걸러버린다. 여기서는 UUID *형식* 판정이
    // 목적이므로 그 니블을 강제하지 않는다.
    if (hasSkuId && !isUUID(link.skuId, 'loose')) return false;
    return true;
  }

  defaultMessage(): string {
    return 'link 항목은 skuId(UUID) 또는 newSku 중 정확히 하나를 가져야 합니다.';
  }
}

export class MatchingLinkInputDto {
  @ApiProperty({ description: '기존 재고상품 ID. newSku 와 배타.', required: false })
  @Validate(MatchingSkuRefConstraint)
  skuId?: string;

  @ApiProperty({
    description: '새로 만들 재고상품 정의. skuId 와 배타. inventory.manage 권한이 필요하다.',
    type: CreateSkuDto,
    required: false,
  })
  @ValidateIf((link: MatchingLinkInputDto) => link.newSku !== undefined && link.newSku !== null)
  @ValidateNested()
  @Type(() => CreateSkuDto)
  newSku?: CreateSkuDto;

  @ApiProperty({ description: '구성 수량', minimum: 1, default: 1, required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;
}
