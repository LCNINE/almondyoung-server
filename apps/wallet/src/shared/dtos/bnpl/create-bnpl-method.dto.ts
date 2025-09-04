// shared/dtos/bnpl/create-bnpl-method.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Min,
  Max,
} from 'class-validator';

export class CreateBNPLMethodDto {
  @ApiProperty({
    description: '사용자 ID',
    example: 'user_123456789',
  })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    description: 'BNPL 결제수단 별칭',
    example: '아몬드영 후불결제',
  })
  @IsString()
  @IsNotEmpty()
  methodName: string;

  @ApiProperty({
    description: '회원 실명',
    example: '홍길동',
  })
  @IsString()
  @IsNotEmpty()
  memberName: string;

  @ApiProperty({
    description: '휴대폰 번호',
    example: '01012345678',
  })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({
    description: '신용 한도 (원)',
    example: 1000000,
    minimum: 100000,
    maximum: 10000000,
  })
  @IsNumber()
  @Min(100000)
  @Max(10000000)
  creditLimit: number;

  @ApiProperty({
    description: '결제일 (매월 몇일)',
    example: 25,
    minimum: 1,
    maximum: 28,
  })
  @IsNumber()
  @Min(1)
  @Max(28)
  billingCycleDay: number;

  @ApiProperty({
    description: '약관 URL',
    example: 'https://example.com/terms',
    required: false,
  })
  @IsOptional()
  @IsString()
  termsUrl?: string;
}
