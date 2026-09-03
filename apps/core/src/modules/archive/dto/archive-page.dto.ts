import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { type ArchiveSpace } from '../schema/archive.schema';

const SPACES: ArchiveSpace[] = ['team', 'private'];

export class CreateArchivePageDto {
  @ApiProperty({ description: '상위 페이지 ID. 없으면 스페이스 루트', required: false })
  @IsUUID()
  @IsOptional()
  parentId?: string;

  @ApiProperty({ description: '스페이스', enum: SPACES, default: 'team', required: false })
  @IsIn(SPACES)
  @IsOptional()
  space?: ArchiveSpace;

  @ApiProperty({ description: '제목', required: false })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  title?: string;

  @ApiProperty({ description: '아이콘 이모지', required: false })
  @IsString()
  @MaxLength(32)
  @IsOptional()
  icon?: string;
}

export class UpdateArchivePageDto {
  @ApiProperty({ description: '제목', required: false })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  title?: string;

  @ApiProperty({ description: '아이콘 이모지. 빈 문자열이면 해제', required: false, nullable: true })
  @IsString()
  @MaxLength(32)
  @IsOptional()
  icon?: string | null;

  @ApiProperty({ description: '커버 이미지 URL. 빈 문자열이면 해제', required: false, nullable: true })
  @IsString()
  @IsOptional()
  coverUrl?: string | null;

  @ApiProperty({ description: '본문 블록 배열(정본)', required: false, type: [Object] })
  @IsArray()
  @IsOptional()
  content?: unknown[];

  @ApiProperty({ description: '본문 마크다운(내보내기·diff 용 파생)', required: false })
  @IsString()
  @IsOptional()
  contentMarkdown?: string;
}

export class MoveArchivePageDto {
  @ApiProperty({ description: '옮길 상위 페이지 ID. null 이면 스페이스 루트', required: false, nullable: true })
  @IsUUID()
  @IsOptional()
  parentId?: string | null;

  @ApiProperty({ description: '형제 사이에서의 위치(0부터). 생략하면 맨 뒤', required: false })
  @IsInt()
  @Min(0)
  @IsOptional()
  position?: number;
}

export class ArchivePageNodeDto {
  @ApiProperty() id: string;
  @ApiProperty({ nullable: true }) parentId: string | null;
  @ApiProperty({ enum: SPACES }) space: ArchiveSpace;
  @ApiProperty() title: string;
  @ApiProperty({ nullable: true }) icon: string | null;
  @ApiProperty({ description: '형제 사이 정렬 키(분수 인덱스). 문자열 오름차순이 곧 표시 순서다' })
  sortKey: string;
  @ApiProperty({ description: '하위 페이지 보유 여부' }) hasChildren: boolean;
  @ApiProperty() updatedAt: Date;
}

export class ArchivePageBreadcrumbDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty({ nullable: true }) icon: string | null;
}

export class ArchivePageDetailDto {
  @ApiProperty() id: string;
  @ApiProperty({ nullable: true }) parentId: string | null;
  @ApiProperty({ enum: SPACES }) space: ArchiveSpace;
  @ApiProperty() title: string;
  @ApiProperty({ nullable: true }) icon: string | null;
  @ApiProperty({ nullable: true }) coverUrl: string | null;
  @ApiProperty({ description: '본문 블록 배열', type: [Object] }) content: unknown[];
  @ApiProperty() contentMarkdown: string;
  @ApiProperty({ nullable: true }) createdBy: string | null;
  @ApiProperty({ nullable: true }) updatedBy: string | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
  @ApiProperty() isFavorite: boolean;
  @ApiProperty({ type: [ArchivePageBreadcrumbDto] }) breadcrumbs: ArchivePageBreadcrumbDto[];
}

/** 자동 저장 응답 — 브레드크럼처럼 매번 다시 계산해야 하는 값은 싣지 않는다. */
export class ArchivePageSaveResultDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty({ nullable: true }) icon: string | null;
  @ApiProperty({ nullable: true }) coverUrl: string | null;
  @ApiProperty({ nullable: true }) updatedBy: string | null;
  @ApiProperty() updatedAt: Date;
}

export class ArchiveSearchHitDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty({ nullable: true }) icon: string | null;
  @ApiProperty({ enum: SPACES }) space: ArchiveSpace;
  @ApiProperty({ description: '본문에서 찾은 부분의 앞뒤 문맥', nullable: true }) snippet: string | null;
  @ApiProperty({ type: [ArchivePageBreadcrumbDto] }) breadcrumbs: ArchivePageBreadcrumbDto[];
  @ApiProperty() updatedAt: Date;
}

/**
 * 검색 응답. 결과를 배열로만 주면 «상한에 걸린 30건»이 «전부 30건»으로 읽힌다 —
 * 잘렸는지 여부를 화면이 알아야 문구를 정확히 쓸 수 있다.
 */
export class ArchiveSearchResultDto {
  @ApiProperty({ type: [ArchiveSearchHitDto] }) hits: ArchiveSearchHitDto[];

  @ApiProperty({ description: '상한에 걸려 잘렸는지. true 면 보여준 것보다 더 있다' })
  hasMore: boolean;

  @ApiProperty({ description: '한 번에 돌려주는 최대 건수' }) limit: number;
}

export class ArchivePageVersionDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty({ nullable: true }) authorId: string | null;
  @ApiProperty() createdAt: Date;
}

export class ArchivePageVersionDetailDto extends ArchivePageVersionDto {
  @ApiProperty({ type: [Object] }) content: unknown[];
  @ApiProperty() contentMarkdown: string;
}

export class ArchiveTrashItemDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty({ nullable: true }) icon: string | null;
  @ApiProperty({ enum: SPACES }) space: ArchiveSpace;
  @ApiProperty({ nullable: true }) deletedAt: Date | null;
  @ApiProperty({ nullable: true }) deletedBy: string | null;
  @ApiProperty({ description: '함께 지워진 하위 페이지 수' }) descendantCount: number;
}
