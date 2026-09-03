import type { ArchivePage, ArchivePageVersion } from '../schema/archive.schema';
import type { ArchiveNodeRow, ArchiveTrashRow } from '../archive.reader';
import { buildSnippet } from '../archive-content';
import {
  ArchivePageBreadcrumbDto,
  ArchivePageDetailDto,
  ArchivePageNodeDto,
  ArchivePageSaveResultDto,
  ArchivePageVersionDetailDto,
  ArchivePageVersionDto,
  ArchiveSearchHitDto,
  ArchiveTrashItemDto,
} from '../dto/archive-page.dto';

/** 부모를 거슬러 올라가다 데이터가 순환하면 멈추기 위한 상한. */
const MAX_ANCESTOR_DEPTH = 64;

export class ArchiveMapper {
  static toNodes(rows: ArchiveNodeRow[]): ArchivePageNodeDto[] {
    const parentsWithChildren = new Set(rows.map((row) => row.parentId).filter((id): id is string => id !== null));

    return rows.map((row) => ({
      id: row.id,
      parentId: row.parentId,
      space: row.space,
      title: row.title,
      icon: row.icon,
      sortKey: row.sortKey,
      hasChildren: parentsWithChildren.has(row.id),
      updatedAt: row.updatedAt,
    }));
  }

  /** 리더가 이미 조상만 뽑아 온 경우. */
  static toBreadcrumbRows(rows: ArchiveNodeRow[]): ArchivePageBreadcrumbDto[] {
    return rows.map((row) => ({ id: row.id, title: row.title, icon: row.icon }));
  }

  static toSaveResult(page: ArchivePage): ArchivePageSaveResultDto {
    return {
      id: page.id,
      title: page.title,
      icon: page.icon,
      coverUrl: page.coverUrl,
      updatedBy: page.updatedBy,
      updatedAt: page.updatedAt,
    };
  }

  /** 루트 → 부모 순서. 자기 자신은 포함하지 않는다. 검색처럼 여러 건을 그릴 때 쓴다. */
  static toBreadcrumbs(
    page: Pick<ArchivePage, 'parentId'>,
    index: Map<string, ArchiveNodeRow>,
  ): ArchivePageBreadcrumbDto[] {
    const trail: ArchivePageBreadcrumbDto[] = [];
    const seen = new Set<string>();

    let cursor = page.parentId;
    while (cursor && trail.length < MAX_ANCESTOR_DEPTH && !seen.has(cursor)) {
      seen.add(cursor);
      const node = index.get(cursor);
      if (!node) break;

      trail.push({ id: node.id, title: node.title, icon: node.icon });
      cursor = node.parentId;
    }

    return trail.reverse();
  }

  static toDetail(
    page: ArchivePage,
    isFavorite: boolean,
    breadcrumbs: ArchivePageBreadcrumbDto[],
  ): ArchivePageDetailDto {
    return {
      id: page.id,
      parentId: page.parentId,
      space: page.space,
      title: page.title,
      icon: page.icon,
      coverUrl: page.coverUrl,
      content: toBlockArray(page.content),
      contentMarkdown: page.contentMarkdown,
      createdBy: page.createdBy,
      updatedBy: page.updatedBy,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
      isFavorite,
      breadcrumbs,
    };
  }

  static toSearchHits(pages: ArchivePage[], query: string, index: Map<string, ArchiveNodeRow>): ArchiveSearchHitDto[] {
    return pages.map((page) => ({
      id: page.id,
      title: page.title,
      icon: page.icon,
      space: page.space,
      snippet: buildSnippet(page.searchText, query),
      breadcrumbs: ArchiveMapper.toBreadcrumbs(page, index),
      updatedAt: page.updatedAt,
    }));
  }

  /**
   * 휴지통은 삭제의 «뿌리»만 보여준다 — 하위 페이지까지 나열하면 한 번의 삭제가
   * 수십 줄로 보인다. 부모가 함께 삭제된 행은 그 부모 밑으로 접어 개수만 센다.
   */
  static toTrashItems(rows: ArchiveTrashRow[]): ArchiveTrashItemDto[] {
    const byId = new Map(rows.map((row) => [row.id, row]));
    const isRoot = (row: ArchiveTrashRow): boolean => !row.parentId || !byId.has(row.parentId);
    const childCount = new Map<string, number>();

    for (const row of rows) {
      if (isRoot(row)) continue;
      const root = findDeletedRoot(row, byId);
      if (root) childCount.set(root.id, (childCount.get(root.id) ?? 0) + 1);
    }

    return rows.filter(isRoot).map((row) => ({
      id: row.id,
      title: row.title,
      icon: row.icon,
      space: row.space,
      deletedAt: row.deletedAt,
      deletedBy: row.deletedBy,
      descendantCount: childCount.get(row.id) ?? 0,
    }));
  }

  static toVersion(version: ArchivePageVersion): ArchivePageVersionDto {
    return {
      id: version.id,
      title: version.title,
      authorId: version.authorId,
      createdAt: version.createdAt,
    };
  }

  static toVersionDetail(version: ArchivePageVersion): ArchivePageVersionDetailDto {
    return {
      ...ArchiveMapper.toVersion(version),
      content: toBlockArray(version.content),
      contentMarkdown: version.contentMarkdown,
    };
  }
}

/** 함께 지워진 조상들을 거슬러 올라가 삭제의 «뿌리»를 찾는다. */
function findDeletedRoot(row: ArchiveTrashRow, byId: Map<string, ArchiveTrashRow>): ArchiveTrashRow | null {
  const seen = new Set<string>([row.id]);
  let current = row;

  for (let depth = 0; depth < MAX_ANCESTOR_DEPTH; depth += 1) {
    const parentId = current.parentId;
    if (!parentId) return current;

    const parent = byId.get(parentId);
    if (!parent) return current;
    if (seen.has(parent.id)) return current;

    seen.add(parent.id);
    current = parent;
  }

  return current;
}

/** jsonb 는 무엇이든 담을 수 있으므로, 편집기가 기대하는 배열 모양만 통과시킨다. */
function toBlockArray(content: unknown): unknown[] {
  return Array.isArray(content) ? content : [];
}
