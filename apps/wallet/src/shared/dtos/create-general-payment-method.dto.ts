// 파일명: create-general-payment-method.dto.ts (수정 완료)
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsNumber,
  ValidateNested,
  IsBoolean,
  ValidateIf,
  Min,
  Max,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

// 카드 정보 DTO
export class CardInfoDto {
  @ApiProperty({
    description: '카드 번호 전체 (하이픈 없이)',
    example: '1111222233334444',
  })
  @IsString()
  @IsNotEmpty()
  cardNumber: string;

  @ApiProperty({ description: '카드 소유자 이름', example: '홍길동' })
  @IsString()
  @IsNotEmpty()
  cardHolderName: string;

  @ApiProperty({ description: '유효기간 (MM/YY)', example: '12/25' })
  @IsString()
  @IsNotEmpty()
  expiryDate: string;

  @ApiProperty({
    description: '카드 소유주 생년월일(YYMMDD) 또는 사업자등록번호 10자리',
    example: '900101',
  })
  @IsString()
  @IsNotEmpty()
  birthDate: string;

  // ✅ [추가] 카드 비밀번호 앞 2자리를 입력받기 위한 필드
  @ApiProperty({ description: '카드 비밀번호 앞 2자리', example: '12' })
  @IsString()
  @IsNotEmpty()
  cardPassword: string;

  @ApiPropertyOptional({
    description: '휴대폰 번호',
    example: '01012345678',
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({
    description: '결제일 (매월 1일~28일)',
    example: 15,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(28)
  billingCycleDay?: number;
}

// 메인 DTO
export class CreateGeneralPaymentMethodDto {
  @ApiProperty({ description: '사용자 ID', example: 'user_123456789' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    description: '결제수단 타입',
    enum: ['CARD', 'REWARD_POINT'],
    example: 'CARD',
  })
  @IsEnum(['CARD', 'REWARD_POINT'])
  methodType: 'CARD' | 'REWARD_POINT';

  @ApiProperty({ description: '결제수단 별칭', example: '주 사용 카드' })
  @IsString()
  @IsNotEmpty()
  methodName: string;

  @ApiPropertyOptional({
    description: '기본 결제수단 설정 여부',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({
    description: '카드 정보 (methodType이 CARD인 경우 필수)',
    type: CardInfoDto,
  })
  @ValidateIf((o: CreateGeneralPaymentMethodDto) => o.methodType === 'CARD')
  @IsNotEmpty({ message: 'methodType이 CARD인 경우 cardInfo는 필수입니다' })
  @ValidateNested()
  @Type(() => CardInfoDto)
  cardInfo?: CardInfoDto;
}