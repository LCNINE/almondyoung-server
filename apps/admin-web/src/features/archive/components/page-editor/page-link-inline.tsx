'use client';

import { useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, HelpCircle, Trash2 } from 'lucide-react';
import { createReactInlineContentSpec } from '@blocknote/react';
import {
  archivePageTitleCache,
  useArchiveEditorScope,
  useSubPageTarget,
} from './sub-page-block';

export const PAGE_LINK_INLINE_TYPE = 'pageLink';

/**
 * 문장 한가운데서 다른 문서를 «참조»한다. 본문 안 하위 페이지 블록(`subPage`)이 «소유»라면
 * 이쪽은 참조다 — 링크를 만들어도 부모-자식 관계가 생기지 않고, 트리 위치도 바꾸지 않는다.
 * 노션 본문에도 두 형태가 따로 있어서(문단 전체가 링크 / 문장 속 링크) 그릇이 둘 다 필요하다.
 *
 * 저장하는 것은 `pageId` 하나뿐이다. 특히 `text` 라는 이름의 prop 을 만들면 안 된다 —
 * 서버의 검색 평문 생성기가 블록 JSON 에서 `text` 키만 긁어모으므로, 그 순간 참조당한 문서의
 * 제목이 참조한 문서의 검색어로 딸려 들어간다(대상은 자기 제목으로 이미 검색된다).
 */
function PageLinkInlineView({ pageId }: { pageId: string }) {
  const router = useRouter();
  const scope = useArchiveEditorScope();
  // 참조는 위치와 무관하므로 «다른 위치» 판정은 쓰지 않는다. 상태는 정상/지워짐/없음 셋이다.
  const target = useSubPageTarget(pageId, undefined, scope?.space);

  const go = useCallback(
    () => router.push(`/archive/${pageId}`),
    [pageId, router]
  );

  /*
   * 링크에 포커스가 있어도 Enter 로는 안 열린다 — 편집기가 keydown 을 먼저 받아
   * 문단을 쪼개고 기본 동작을 막는다(브라우저 실측). React 의 onKeyDown 은 루트에
   * 붙어 있어 편집기보다 늦게 도니 소용이 없고, 링크 자신에게 직접 매단 리스너만
   * 편집기보다 앞선다. 여기서 받고 편집기로는 넘기지 않는다.
   */
  const detach = useRef<(() => void) | null>(null);

  // 링크는 상태에 따라 붙었다 떨어졌다 하므로 ref 콜백으로 단다. useEffect 로 달면
  // 처음 렌더(«불러오는 중»)에는 링크가 없어 아무것도 못 달고 그대로 끝난다.
  const keyboardRef = useCallback(
    (element: HTMLAnchorElement | null) => {
      detach.current?.();
      detach.current = null;
      if (!element) return;

      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        go();
      };

      element.addEventListener('keydown', onKeyDown);
      detach.current = () =>
        element.removeEventListener('keydown', onKeyDown);
    },
    [go]
  );

  if (target.state === 'ok')
    archivePageTitleCache.set(pageId, target.title || '제목 없음');

  if (target.state === 'loading') {
    return (
      <span className="archive-page-link archive-page-link--muted" aria-busy>
        <FileText className="archive-page-link__icon" aria-hidden />
        문서 확인 중…
      </span>
    );
  }

  if (target.state === 'trashed') {
    return (
      <span className="archive-page-link archive-page-link--muted">
        <Trash2 className="archive-page-link__icon" aria-hidden />
        <span className="line-through">{target.title || '제목 없음'}</span>
        <span className="sr-only"> (지워진 문서)</span>
      </span>
    );
  }

  if (target.state === 'missing') {
    return (
      <span className="archive-page-link archive-page-link--muted">
        <HelpCircle className="archive-page-link__icon" aria-hidden />
        찾을 수 없는 문서
      </span>
    );
  }

  return (
    /*
     * 문장 안에 섞이므로 밑줄 대신 색과 «문서 아이콘»으로 구분한다 — 색만으로 가르면
     * 색을 못 가리는 사람에게는 링크인지 알 길이 없다. 아이콘이 그 대체 단서다.
     * href 를 실제로 넣어야 새 탭으로 열기·주소 복사가 되고, 이동은 라우터로 가로챈다.
     */
    <a
      href={`/archive/${pageId}`}
      className="archive-page-link archive-page-link--ref"
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        go();
      }}
      ref={keyboardRef}
    >
      {target.icon ? (
        <span className="archive-page-link__icon" aria-hidden>
          {target.icon}
        </span>
      ) : (
        <FileText className="archive-page-link__icon" aria-hidden />
      )}
      {target.title || '제목 없음'}
    </a>
  );
}

/**
 * `createReactInlineContentSpec` 은 스펙을 그대로 돌려준다 — 블록 쪽
 * `createReactBlockSpec` 이 팩토리를 돌려주는 것과 다르니 호출해서 넣지 않는다.
 */
export const pageLinkInlineSpec = createReactInlineContentSpec(
  {
    type: PAGE_LINK_INLINE_TYPE,
    propSchema: { pageId: { default: '' } },
    content: 'none',
  },
  {
    render: ({ inlineContent }) => (
      <PageLinkInlineView pageId={inlineContent.props.pageId} />
    ),
    // 마크다운 파생이 이 HTML 을 거친다. 제목 캐시가 비어 있으면 라벨이 id 로 떨어질 뿐
    // 링크 자체는 온전하다 — 편집기 밖에서 렌더되므로 여기서는 조회를 할 수 없다.
    toExternalHTML: ({ inlineContent }) => {
      const { pageId } = inlineContent.props;
      return (
        <a href={`/archive/${pageId}`}>
          {archivePageTitleCache.get(pageId) ?? pageId}
        </a>
      );
    },
  }
);
