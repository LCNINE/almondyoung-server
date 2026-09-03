import { and, eq, isNull, or, type SQL } from 'drizzle-orm';
import { archivePages, type ArchivePage, type ArchiveSpace } from './schema/archive.schema';

/**
 * 볼 수 있는 페이지: 팀 스페이스 전체 + 자기 개인 스페이스.
 * 관리자 인증은 가드가 이미 끝냈으므로 여기서는 스페이스 소속만 본다.
 */
export function visibleToActor(actorId: string): SQL {
  const predicate = or(
    eq(archivePages.space, 'team'),
    and(eq(archivePages.space, 'private'), eq(archivePages.ownerId, actorId)),
  );
  // or() 는 인자가 모두 있으면 항상 SQL 을 돌려주지만 타입상 undefined 가 섞인다.
  if (!predicate) throw new Error('archive: visibility predicate could not be built');
  return predicate;
}

/** 살아있는(휴지통에 없는) 페이지만. */
export function notDeleted(): SQL {
  return isNull(archivePages.deletedAt);
}

export function canAccess(page: Pick<ArchivePage, 'space' | 'ownerId'>, actorId: string): boolean {
  return page.space === 'team' || page.ownerId === actorId;
}

export function ownerForSpace(space: ArchiveSpace, actorId: string): string | null {
  return space === 'private' ? actorId : null;
}
