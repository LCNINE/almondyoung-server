// shared/dtos/bnpl/submit-consent.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class SubmitConsentDto {
  @ApiProperty({
    description: 'HMS 회원 ID',
    example: 'HMS_MEMBER_123456789',
  })
  @IsString()
  @IsNotEmpty()
  memberId: string;
}

// Response DTO (class-validator 불필요)
export class ConsentResponseDto {
  @ApiProperty({ description: '성공 여부' })
  success: boolean;

  @ApiProperty({ description: '응답 메시지' })
  message: string;

  @ApiProperty({ description: '등록 완료 여부' })
  registrationComplete: boolean;

  @ApiProperty({ description: '다음 단계 안내', required: false })
  nextSteps?: string[];
}

export class MemberStatusResponseDto {
  @ApiProperty({ description: 'HMS 회원 ID' })
  memberId: string;

  @ApiProperty({
    description: '회원 상태',
    enum: ['PENDING', 'REGISTERED', 'FAILED'],
  })
  status: 'PENDING' | 'REGISTERED' | 'FAILED';

  @ApiProperty({
    description: '등록 완료 시간',
    required: false,
  })
  registeredAt?: string;

  @ApiProperty({ description: '신용 한도' })
  creditLimit: number;

  @ApiProperty({ description: '승인된 한도' })
  approvedLimit: number;

  @ApiProperty({ description: '원본 HMS 응답', required: false })
  rawResponse?: any;
}

export class PaymentMethodResponseDto {
  @ApiProperty({ description: '결제수단 ID' })
  paymentMethodId: string;

  @ApiProperty({ description: '결제수단 상태' })
  status: string;

  @ApiProperty({ description: '사용자 ID' })
  userId: string;

  @ApiProperty({ description: '결제수단 이름' })
  methodName: string;

  @ApiProperty({ description: '결제수단 타입' })
  methodType: string;

  @ApiProperty({ description: 'HMS 회원 ID' })
  hmsMemberId: string;

  @ApiProperty({ description: 'BNPL 계정 ID' })
  bnplAccountId: string;

  @ApiProperty({ description: '메시지' })
  message: string;
}
