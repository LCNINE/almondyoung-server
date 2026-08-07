import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateAiPromptPresetDto {
  @ApiProperty({ description: '양식 제목', maxLength: 120 })
  @IsString()
  @IsNotEmpty({ message: '양식 제목을 입력해주세요.' })
  @MaxLength(120)
  title!: string;

  @ApiProperty({ description: '프롬프트 본문', maxLength: 20000 })
  @IsString()
  @IsNotEmpty({ message: '프롬프트 본문은 비워둘 수 없습니다.' })
  @MaxLength(20000)
  content!: string;

  @ApiProperty({ description: '작성자 식별자 (admin-web 서버가 주입)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  ownerId!: string;

  @ApiPropertyOptional({ description: '작성자 표시 이름' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  ownerName?: string;
}

export class UpdateAiPromptPresetDto {
  @ApiProperty({ description: '양식 제목', maxLength: 120 })
  @IsString()
  @IsNotEmpty({ message: '양식 제목을 입력해주세요.' })
  @MaxLength(120)
  title!: string;

  @ApiProperty({ description: '프롬프트 본문', maxLength: 20000 })
  @IsString()
  @IsNotEmpty({ message: '프롬프트 본문은 비워둘 수 없습니다.' })
  @MaxLength(20000)
  content!: string;

  @ApiProperty({ description: '요청자 식별자 — 소유자와 다르면 403' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  requesterId!: string;
}

export class AiPromptPresetResponseDto {
  @ApiProperty({ description: '양식 ID' })
  id!: string;

  @ApiProperty({ description: '적용 범위 (예: product-description)' })
  scope!: string;

  @ApiProperty({ description: '양식 제목' })
  title!: string;

  @ApiProperty({ description: '프롬프트 본문' })
  content!: string;

  @ApiProperty({ description: '작성자 식별자' })
  ownerId!: string;

  @ApiProperty({ description: '작성자 표시 이름', nullable: true })
  ownerName!: string | null;

  @ApiProperty({ description: '마지막 수정 시각' })
  updatedAt!: string;
}
