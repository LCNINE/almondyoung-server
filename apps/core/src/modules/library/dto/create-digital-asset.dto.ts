import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsUUID, MaxLength } from 'class-validator';

export class CreateDigitalAssetDto {
  @ApiProperty({ description: '자산 이름', maxLength: 255 })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ description: '설명' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'MIME 타입', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  mimeType?: string;

  @ApiPropertyOptional({ description: '썸네일 URL' })
  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  // file-service 에 이미 업로드된 fileId. 동시에 자산 등록과 파일 v1 을 만들고 싶을 때 사용.
  // 메타데이터만 먼저 만들고 싶다면 omit, 이후 `POST /digital-assets/:id/file-versions` 로 v1 push.
  @ApiPropertyOptional({ description: '초기 파일 ID (file-service)' })
  @IsOptional()
  @IsUUID()
  initialFileId?: string;

  @ApiPropertyOptional({ description: '초기 파일 릴리즈 노트' })
  @IsOptional()
  @IsString()
  initialReleaseNote?: string;
}
