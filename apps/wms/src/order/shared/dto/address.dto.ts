import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

/**
 * 배송 주소 DTO (한국식 주소 형식)
 * event-contracts의 ShippingAddress와 동일한 형식
 */
export class AddressDto {
  @ApiProperty({ description: '수령인 이름' })
  @IsString()
  @IsNotEmpty()
  recipientName: string;

  @ApiProperty({ description: '수령인 연락처' })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({ description: '우편번호' })
  @IsString()
  @IsNotEmpty()
  postalCode: string;

  @ApiProperty({ description: '도로명 주소' })
  @IsString()
  @IsNotEmpty()
  roadAddress: string;

  @ApiProperty({ description: '상세 주소' })
  @IsString()
  @IsNotEmpty()
  detailAddress: string;

  @ApiProperty({ description: '배송 메모', required: false })
  @IsString()
  @IsOptional()
  deliveryNote?: string;
}
