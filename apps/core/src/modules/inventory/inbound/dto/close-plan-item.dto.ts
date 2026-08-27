import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** 잔량을 포기하고 입고예정 아이템을 종결할 때의 사유. */
export class ClosePlanItemDto {
  @ApiProperty({ description: '더 기다리지 않기로 한 이유 (공급처 결품·선적 누락 등)', maxLength: 500 })
  @IsString()
  // 공백만 있는 문자열('   ')은 IsNotEmpty 를 통과한다 — admin-web 은 trim 하지만
  // API 직접 호출은 안 막힌다. 감사 필드라 trim 은 검증 전에 온다(최종 전체 리뷰
  // 발견 M5).
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
