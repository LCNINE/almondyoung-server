import { IsString } from 'class-validator';

export class AddressDto {
  @IsString()
  street: string; // 거리명 / 도로명

  @IsString()
  city: string; // 도시 (예: 서울)

  @IsString()
  state: string; // 시/도 (예: 서울특별시)

  @IsString()
  country: string; // 국가 코드 (예: KR)

  @IsString()
  detail: string; // 상세주소 (예: 무슨 아픝 101동 1203호)
}
