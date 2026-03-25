import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class AddressDto {
  @ApiProperty({ description: '주소 1 (기본주소)' })
  @IsString()
  address_1: string;

  @ApiProperty({ description: '주소 2 (상세주소)', required: false })
  @IsString()
  @IsOptional()
  address_2?: string;

  @ApiProperty({ description: '도시' })
  @IsString()
  city: string;

  @ApiProperty({ description: '국가 코드', example: 'KR' })
  @IsString()
  country_code: string;

  @ApiProperty({ description: '우편번호' })
  @IsString()
  postal_code: string;

  @ApiProperty({ description: '시/도', example: '서울특별시' })
  @IsString()
  @IsOptional()
  province?: string;
}
