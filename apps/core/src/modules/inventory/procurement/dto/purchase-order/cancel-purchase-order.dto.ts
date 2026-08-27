import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** 발주 자체를 무를 때의 사유. */
export class CancelPurchaseOrderDto {
  @ApiProperty({ description: '취소 사유 (오발주·공급처 사정 등)', maxLength: 500 })
  @IsString()
  // 공백만 있는 문자열('   ')은 IsNotEmpty 를 통과한다 — admin-web 은 trim 하지만
  // API 직접 호출은 안 막힌다. 감사 필드라 trim 은 검증 전에 온다(최종 전체 리뷰
  // 발견 M5).
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
