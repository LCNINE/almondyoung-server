import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

// 스토어프론트 상품 상세의 «상품정보» 표에 그대로 실리는 표시 전용 값들.
export class ProductInfoDto {
  @ApiProperty({ description: '상품번호', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  productNumber?: string;

  @ApiProperty({ description: '상품 무게', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  weight?: string;

  @ApiProperty({ description: '상품 규격', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  dimensions?: string;

  @ApiProperty({ description: '원산지', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  origin?: string;

  @ApiProperty({ description: '용량', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  capacity?: string;

  @ApiProperty({ description: '유효일자', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  expirationDate?: string;

  @ApiProperty({ description: '제조사', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  manufacturer?: string;

  @ApiProperty({ description: '소재', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  material?: string;

  @ApiProperty({ description: '사용방법', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  usage?: string;
}
