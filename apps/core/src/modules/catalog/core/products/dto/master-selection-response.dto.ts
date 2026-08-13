import { ApiProperty } from '@nestjs/swagger';

export class MasterSelectionItemDto {
  @ApiProperty({ description: '상품 마스터 ID' })
  masterId: string;

  @ApiProperty({ description: '비회원에게 멤버십가를 숨김' })
  hideMembershipPriceForNonMembers: boolean;

  @ApiProperty({ description: '멤버십 회원 전용 노출' })
  isVisibleToMembersOnly: boolean;

  @ApiProperty({ description: '해외직구 상품' })
  isOverseas: boolean;
}

export class MasterSelectionResponseDto {
  @ApiProperty({ type: [MasterSelectionItemDto] })
  items: MasterSelectionItemDto[];

  @ApiProperty({ description: '필터에 걸린 상품 수. items 길이와 항상 같다.' })
  total: number;
}
