export type ArchiveSpace = 'team' | 'private';

/** 편집기가 쓰는 블록 한 덩어리. 모양은 편집기 스키마가 정하므로 여기서는 열어 둔다. */
export type ArchiveBlock = Record<string, unknown>;

export interface ArchivePageNodeDto {
  id: string;
  parentId: string | null;
  space: ArchiveSpace;
  title: string;
  icon: string | null;
  /** 형제 사이 정렬 키(분수 인덱스). 문자열 오름차순이 곧 표시 순서다. */
  sortKey: string;
  hasChildren: boolean;
  updatedAt: string;
}

export interface ArchiveBreadcrumbDto {
  id: string;
  title: string;
  icon: string | null;
}

export interface ArchivePageDetailDto {
  id: string;
  parentId: string | null;
  space: ArchiveSpace;
  title: string;
  icon: string | null;
  coverUrl: string | null;
  content: ArchiveBlock[];
  contentMarkdown: string;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  isFavorite: boolean;
  breadcrumbs: ArchiveBreadcrumbDto[];
}

export interface ArchivePageSaveResultDto {
  id: string;
  title: string;
  icon: string | null;
  coverUrl: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

export interface ArchiveSearchHitDto {
  id: string;
  title: string;
  icon: string | null;
  space: ArchiveSpace;
  snippet: string | null;
  breadcrumbs: ArchiveBreadcrumbDto[];
  updatedAt: string;
}

/** 검색 응답 — 잘렸는지를 알아야 «상한에 걸린 30건»을 «전부 30건»으로 쓰지 않는다. */
export interface ArchiveSearchResultDto {
  hits: ArchiveSearchHitDto[];
  hasMore: boolean;
  limit: number;
}

export interface ArchiveTrashItemDto {
  id: string;
  title: string;
  icon: string | null;
  space: ArchiveSpace;
  deletedAt: string | null;
  deletedBy: string | null;
  descendantCount: number;
}

export interface ArchivePageVersionDto {
  id: string;
  title: string;
  authorId: string | null;
  createdAt: string;
}

export interface ArchivePageVersionDetailDto extends ArchivePageVersionDto {
  content: ArchiveBlock[];
  contentMarkdown: string;
}

export interface CreateArchivePageDto {
  parentId?: string;
  space?: ArchiveSpace;
  title?: string;
  icon?: string;
}

export interface UpdateArchivePageDto {
  title?: string;
  icon?: string | null;
  coverUrl?: string | null;
  content?: ArchiveBlock[];
  contentMarkdown?: string;
}

export interface MoveArchivePageDto {
  parentId?: string | null;
  position?: number;
}
