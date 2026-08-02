import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { BulkSessionProgressDto } from './bulk-session-response.dto';

export class BulkSessionImageDto {
  @ApiProperty({ description: '워크북 "이미지" 시트의 이미지키' }) imageKey: string;
  @ApiProperty({
    enum: ['main', 'description'],
    description: '참조 지점이 정한다 — 대표·부가는 main, 본문 디렉티브는 description',
  })
  usage: 'main' | 'description';
  @ApiProperty({ description: '이 용도로 업로드할 때 써야 하는 file-service 컨텍스트' }) contextId: string;
  @ApiProperty({ enum: ['file_id', 'file_name'] }) sourceKind: string;
  @ApiProperty({ description: 'file_name 이면 작업자가 올려야 할 로컬 파일명' }) sourceValue: string;
  @ApiProperty({ enum: ['resolved', 'awaiting_upload'] }) status: string;
  @ApiProperty({ required: false, nullable: true }) fileId: string | null;
  @ApiProperty({
    description:
      '적용될 행(status=pending)이 실제로 참조하는가. false 인 행은 올리지 않아도 다음 단계로 넘어간다 — invalid 행만 참조하던 이미지가 여기 해당한다.',
  })
  required: boolean;
}

export class BulkSessionImageListDto {
  @ApiProperty({ type: [BulkSessionImageDto] }) data: BulkSessionImageDto[];
  @ApiProperty({ description: '필터를 적용한 전체 건수(페이지 이전)' }) total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty({ description: '필터와 무관한 세션 전체 기준 — 전량 게이트의 분모' }) requiredTotal: number;
  @ApiProperty({ description: '필터와 무관한 세션 전체 기준 — 전량 게이트의 분자' }) requiredResolved: number;
}

export class ResolveImageEntryDto {
  @ApiProperty({ description: '워크북 이미지키' })
  @IsString()
  @MaxLength(100)
  imageKey: string;

  @ApiProperty({ enum: ['main', 'description'] })
  @IsIn(['main', 'description'])
  usage: 'main' | 'description';

  @ApiProperty({ description: 'file-service 가 돌려준 fileId' })
  @IsUUID()
  fileId: string;
}

export class ResolveImagesDto {
  @ApiProperty({
    type: [ResolveImageEntryDto],
    description:
      '한 요청 최대 50건. 항목마다 file-service 메타데이터를 확인하므로 상한이 있다 — 브라우저는 업로드가 끝나는 대로 나눠 보낸다.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ResolveImageEntryDto)
  resolutions: ResolveImageEntryDto[];
}

export class ResolveImageResultDto {
  @ApiProperty() imageKey: string;
  @ApiProperty({ enum: ['main', 'description'] }) usage: 'main' | 'description';
  @ApiProperty() ok: boolean;
  @ApiProperty({ required: false, nullable: true, description: 'ok=false 일 때 작업자에게 그대로 보여줄 문구' })
  error: string | null;
}

export class ResolveImagesResponseDto {
  @ApiProperty({
    type: [ResolveImageResultDto],
    description:
      '요청 순서는 보존되지만 인덱스로 짝지으면 안 된다 — 같은 (imageKey, usage) 중복은 마지막 것만 남아 길이가 줄 수 있다. 짝은 (imageKey, usage) 로 짓는다.',
  })
  results: ResolveImageResultDto[];
  @ApiProperty({
    type: BulkSessionProgressDto,
    description: '처리 후 세션 상태 — 전량 게이트가 열렸으면 phase 가 drafting 이다',
  })
  progress: BulkSessionProgressDto;
}
