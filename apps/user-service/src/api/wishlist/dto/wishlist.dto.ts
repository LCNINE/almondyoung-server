import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class AddToWishlistDto {
  @ApiProperty({
    description: '찜하기에 추가할 상품 ID',
    example: 'prod_01H9ZRXKJ123456789',
  })
  @IsString({ message: '상품 ID는 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '상품 ID는 필수 입력 항목입니다.' })
  productId: string;
}
