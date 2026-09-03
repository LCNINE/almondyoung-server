import type {
  ArchivePageDetailDto,
  ArchivePageSaveResultDto,
  UpdateArchivePageDto,
} from '@/lib/types/dto/archive';

/**
 * 저장한 값을 상세 캐시 «항목» 에 되쓴 결과를 만든다.
 *
 * 서버 응답에는 본문이 없고(`ArchivePageSaveResultDto`), 상세 조회는 `staleTime: Infinity` 라
 * 이 병합을 안 하면 캐시의 `content` 가 «문서를 처음 연 순간의 값» 에 영원히 묶인다.
 * 그러면 다른 문서에 갔다 돌아왔을 때 방금 쓴 본문이 없는 편집기가 뜨고,
 * 거기서 한 글자만 쳐도 그 빈 본문이 서버의 진짜 본문을 덮는다.
 *
 * react-query 를 모르는 순수 함수로 둔다. 루트 jest 는 `apps/admin-web/node_modules` 를
 * 해석하지 못하므로(루트 `npm ci` 가 그걸 깔지 않는다) `@tanstack/react-query` 를 값으로
 * import 하는 파일은 검증 게이트에서 스위트째 죽는다 — 판정이 걸린 로직은 여기 둔다.
 */
export function mergeSavedPage(
  previous: ArchivePageDetailDto | undefined,
  dto: UpdateArchivePageDto,
  result?: ArchivePageSaveResultDto
): ArchivePageDetailDto | undefined {
  // 캐시에 없던 페이지를 여기서 만들어 내지 않는다 — 본문 없는 부분 문서가 진짜 문서 행세를 한다.
  if (!previous) return previous;

  const next: ArchivePageDetailDto = result
    ? {
        ...previous,
        title: result.title,
        icon: result.icon,
        coverUrl: result.coverUrl,
        updatedAt: result.updatedAt,
        updatedBy: result.updatedBy,
      }
    : { ...previous };

  // 보낸 것만 반영한다 — 제목만 저장한 요청이 본문을 건드리면 안 된다.
  if (dto.content !== undefined) next.content = dto.content;
  if (dto.contentMarkdown !== undefined)
    next.contentMarkdown = dto.contentMarkdown;

  return next;
}
