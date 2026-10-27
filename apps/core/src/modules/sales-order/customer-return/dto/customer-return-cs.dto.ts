import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

/** 반품 미도착 닫기 — 온전히 도착한 벌만 남기고 나머지를 닫는다(K8 PR6b N8) */
export class CloseCustomerReturnMissingDto {
  @ApiProperty({ maxLength: 500, description: 'CS 가 남기는 사유' })
  @IsString()
  @Matches(/\S/)
  @MaxLength(500)
  memo: string;
}

/** 보류 정산 — 보류 차감(원)을 정해 정산을 연다. 0 이면 차감 없이(K8 PR6b N2) */
export class SettleHeldCustomerReturnDto {
  @ApiProperty({ minimum: 0, description: '보류 차감(원). 남은 돈보다 크면 Medusa 가 남은 만큼만 뺀다(N3)' })
  @IsInt()
  @Min(0)
  deduction: number;

  @ApiProperty({ maxLength: 500, description: 'CS 가 남기는 사유 — 차감이 있으면 Medusa 차감 메모로 간다' })
  @IsString()
  @Matches(/\S/)
  @MaxLength(500)
  memo: string;
}

/** 선환불 요청 — 수령 전에 RETURN 환불을 먼저 낸다(K8 PR6b N4). 반품당 한 번 */
export class RequestCustomerReturnPrepayDto {
  @ApiPropertyOptional({ minimum: 1, description: '환불액(원). 없으면 Medusa 기본값(품목 값 − 택배비 예상)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;

  @ApiPropertyOptional({ enum: ['auto', 'manual'], default: 'auto', description: 'manual 이면 계좌 송금' })
  @IsOptional()
  @IsIn(['auto', 'manual'])
  refundMode?: 'auto' | 'manual';

  @ApiProperty({ maxLength: 500, description: 'CS 가 남기는 사유' })
  @IsString()
  @Matches(/\S/)
  @MaxLength(500)
  memo: string;
}
