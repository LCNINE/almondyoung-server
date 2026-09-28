import { ApiProperty } from '@nestjs/swagger';
import { IsHexColor, IsOptional, IsString, IsUrl, MaxLength, ValidateIf } from 'class-validator';

export class UpdateEmailLayoutDto {
  @ApiProperty({ required: false, nullable: true, description: '헤더 로고 이미지 주소. 비우면 상호를 글자로 넣는다' })
  @IsOptional()
  @ValidateIf((_, value) => typeof value === 'string' && value.trim() !== '')
  @IsUrl({ require_tld: false, require_protocol: true })
  @MaxLength(500)
  logoUrl?: string | null;

  @ApiProperty({ required: false, example: '#ff6600' })
  @IsOptional()
  @IsHexColor()
  brandColor?: string;

  @ApiProperty({ required: false, example: '#1a1c20' })
  @IsOptional()
  @IsHexColor()
  textColor?: string;

  @ApiProperty({ required: false, example: '#f7f8f9' })
  @IsOptional()
  @IsHexColor()
  backgroundColor?: string;

  @ApiProperty({ required: false, description: '푸터 문의 줄 (마크다운)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  footerContact?: string;

  @ApiProperty({ required: false, description: '푸터 사업자 정보. 줄바꿈으로 여러 줄' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  footerBusiness?: string;
}
