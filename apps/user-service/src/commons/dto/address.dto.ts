import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class AddressDto {
  @ApiProperty({ description: '거리명 / 도로명' })
  @IsString()
  street: string;

  @ApiProperty({ description: '도시 (예: 서울)' })
  @IsString()
  city: string;

  @ApiProperty({ description: '시/도 (예: 서울특별시)' })
  @IsString()
  state: string;

  @ApiProperty({ description: '국가 코드 (예: KR)' })
  @IsString()
  country: string;

  @ApiProperty({ description: '상세주소 (예: 무슨 아파트 101동 1203호)' })
  @IsString()
  detail: string;
}
