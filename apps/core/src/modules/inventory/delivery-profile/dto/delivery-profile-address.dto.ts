import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** 공백뿐인 값 거부 — `@IsNotEmpty` 는 ' ' 를 통과시킨다. 하류(assertProfileComplete)는 trim 후 판정한다. */
const NOT_BLANK = /\S/;

export class DeliveryProfileSenderDto {
  @ApiProperty({ description: '발송인 이름' })
  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(100)
  name: string;

  @ApiProperty({ description: '발송인 전화번호' })
  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(30)
  phone: string;
}

export class DeliveryProfileAddressDto {
  @ApiProperty({ description: '우편번호' })
  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(10)
  postalCode: string;

  @ApiProperty({ description: '도로명 주소' })
  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(255)
  roadAddress: string;

  @ApiProperty({ description: '상세 주소 (빈 문자열 허용)' })
  @IsString()
  @MaxLength(255)
  detailAddress: string;
}

export class DeliveryProfileReturnAddressDto extends DeliveryProfileAddressDto {
  @ApiProperty({ description: '반품지 연락처', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}

export { NOT_BLANK };
