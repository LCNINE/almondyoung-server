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
    if (hasSkuId && !isUUID(link.skuId)) return false;
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
