import { IsIn, IsString, MaxLength } from 'class-validator';

export class ReturnEligibilityRequestDto {
  /** 반품 요청은 Medusa 스토어프론트 주문만 부른다 — 다른 채널은 Medusa 에 반품 레코드가 없다. */
  @IsIn(['medusa'])
  salesChannel!: 'medusa';

  @IsString()
  @MaxLength(255)
  externalOrderId!: string;
}
