'use client';

import Link from 'next/link';
import { ExternalLink, ImageOff } from 'lucide-react';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import { buildDraftEditPath } from '@/features/mall/my-drafts/lib/draft-edit-path';
import styles from './assistant-panel.module.css';

/**
 * 도구 결과를 화면으로 보여준다.
 *
 * 모델이 마크다운 표를 그리면 448px 패널에 20행이 쏟아져 읽을 수가 없다. 그래서
 * 목록형 결과는 여기서 카드로 그리고, 모델에게는 표를 쓰지 말라고 지시한다.
 * 아직 렌더러가 없는 도구는 조용히 실행됨 한 줄로만 남는다.
 */

type ToolCall = { name: string; input?: unknown; result?: unknown };

/** 링크로 이동할 때 패널을 닫는다. 열린 채로 두면 뒤에서 이동만 하고 화면은 그대로다. */
type Nav = { onNavigate: () => void };

type ProductRow = {
  masterId?: string;
  versionId?: string;
  name?: string;
  brand?: string | null;
  productCode?: string | null;
  thumbnail?: string | null;
  status?: string;
  soldOutState?: string;
  priceSummary?: {
    minSalePrice?: number | null;
    maxSalePrice?: number | null;
    minMemberPrice?: number | null;
    maxMemberPrice?: number | null;
  } | null;
};

function won(n: number | null | undefined) {
  return typeof n === 'number' ? n.toLocaleString('ko-KR') : null;
}

/** 단일가면 한 값, 범위면 `min~max`. */
function priceRange(min?: number | null, max?: number | null) {
  const lo = won(min);
  const hi = won(max);
  if (lo === null) return null;
  return hi && hi !== lo ? `${lo}~${hi}` : lo;
}

/**
 * 미발행 Draft 를 Active 상세 경로로 보내면 404 다. 기존 상품의 Draft 도 그냥 보내면
 * 엉뚱하게 Active 버전이 열린다 — versionId 를 실어야 그 Draft 가 열린다.
 */
function productHref(p: ProductRow, draft?: boolean): string {
  if (!p.masterId) return '#';
  if (draft && p.versionId) return buildDraftEditPath(p.masterId, p.versionId);
  return `/mall/products-list/${p.masterId}`;
}

function ProductCards({
  rows,
  total,
  keyword,
  draft,
  onNavigate,
}: {
  rows: ProductRow[];
  total?: number;
  keyword?: string;
  /** 작성중 Draft 목록인가. 목적지와 「더 보기」가 갈린다. */
  draft?: boolean;
} & Nav) {
  const shown = rows.slice(0, 8);
  const rest = (total ?? rows.length) - shown.length;

  return (
    <div className={styles.productCards}>
      {shown.map((p, i) => {
        const sale = priceRange(
          p.priceSummary?.minSalePrice,
          p.priceSummary?.maxSalePrice
        );
        const member = priceRange(
          p.priceSummary?.minMemberPrice,
          p.priceSummary?.maxMemberPrice
        );
        const soldOut =
          p.soldOutState === 'all' || p.soldOutState === 'partial';

        return (
          <Link
            key={p.masterId ?? i}
            href={productHref(p, draft)}
            onClick={onNavigate}
            className={styles.productCard}
          >
            <div className={styles.productImage}>
              {resolvePublicFileUrl(p.thumbnail) ? (
                // 외부 파일 도메인이 여러 곳이라 next/image 최적화 대상이 아니다.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={resolvePublicFileUrl(p.thumbnail)!}
                  alt=""
                  loading="lazy"
                />
              ) : (
                <ImageOff size={16} aria-hidden />
              )}
            </div>

            <div className={styles.productBody}>
              <p className={styles.productName}>{p.name ?? '(이름 없음)'}</p>

              <div className={styles.productMeta}>
                {p.brand && <span>{p.brand}</span>}
                {p.productCode && <span>{p.productCode}</span>}
                {soldOut && (
                  <span className={styles.soldOut}>
                    {p.soldOutState === 'all' ? '품절' : '부분품절'}
                  </span>
                )}
                {p.status && p.status !== 'active' && <span>{p.status}</span>}
              </div>

              {sale && (
                <p className={styles.productPrice}>
                  <strong>{sale}원</strong>
                  {member && member !== sale && <span>회원 {member}원</span>}
                </p>
              )}
            </div>
          </Link>
        );
      })}

      {rest > 0 && (
        <Link
          href={
            draft
              ? '/mall/my-drafts'
              : keyword
                ? `/mall/products-list?q=${encodeURIComponent(keyword)}`
                : '/mall/products-list'
          }
          onClick={onNavigate}
          className={styles.moreProducts}
        >
          {draft ? '작성중 상품' : '상품 목록'}에서{' '}
          {rest.toLocaleString('ko-KR')}개 더 보기
          <ExternalLink size={12} aria-hidden />
        </Link>
      )}
    </div>
  );
}

/** 도구 결과에서 상품 배열을 꺼낸다. 목록은 `{data,total}`, 단건은 객체 하나다. */
function asProducts(
  result: unknown
): { rows: ProductRow[]; total?: number } | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  if (r.ok === false) return null;

  if (Array.isArray(r.data)) {
    return {
      rows: r.data as ProductRow[],
      total: r.total as number | undefined,
    };
  }
  if (typeof r.masterId === 'string' || typeof r.versionId === 'string') {
    return { rows: [r as ProductRow] };
  }
  return null;
}

export /** 상품을 만들거나 고친 도구들. 결과에서 방금 다룬 상품을 집어낸다. */
const MUTATION_TOOLS = new Set([
  'create_product',
  'create_product_draft',
  'update_product_draft',
  'set_product_price',
  'write_product_description',
  'upload_product_image',
  'publish_product_version',
]);

/**
 * 방금 만들거나 고친 상품으로 가는 링크.
 *
 * 카드로 그리면 생성 결과(이름 없는 "새 상품")와 수정 결과가 나란히 떠서
 * 상품을 둘 만든 것처럼 보인다. 그래서 링크 한 줄로만 남긴다.
 */
function touchedProduct(calls: ToolCall[]): {
  masterId: string;
  versionId?: string;
  published: boolean;
} | null {
  let masterId: string | undefined;
  let versionId: string | undefined;
  let published = false;

  for (const call of calls) {
    if (!MUTATION_TOOLS.has(call.name)) continue;
    const from = { ...(call.input as object), ...(call.result as object) } as {
      masterId?: string;
      versionId?: string;
      id?: string;
    };
    // 실패한 호출의 결과는 믿지 않는다. 다만 masterId·versionId 는 인자에도 있어
    // 어떤 상품을 다루려 했는지는 알 수 있으므로 링크 자체는 만들어 준다.
    const failed =
      typeof call.result === 'object' &&
      call.result !== null &&
      (call.result as { ok?: boolean }).ok === false;

    if (typeof from.masterId === 'string') masterId = from.masterId;
    // create_product 는 새 버전 id 를 `id` 로 준다.
    if (typeof from.versionId === 'string') versionId = from.versionId;
    else if (!failed && typeof from.id === 'string' && call.name === 'create_product') {
      versionId = from.id;
    }

    // 발행은 «성공했을 때만» 발행으로 본다. 확인 게이트에 막히거나 409 가 나도
    // 호출은 남으므로, 호출 여부로 판단하면 초안을 발행됐다고 안내하게 된다.
    if (call.name === 'publish_product_version' && !failed) published = true;
  }

  return masterId ? { masterId, versionId, published } : null;
}

export const TOOL_LABELS: Record<string, string> = {
  search_products: '상품 검색',
  list_my_drafts: '내 초안 확인',
  get_product: '상품 상세 확인',
  create_product: '상품 생성',
  create_product_draft: '수정 초안 생성',
  update_product_draft: '상품 정보 수정',
  set_product_price: '가격 설정',
  publish_product_version: '상품 발행',
  upload_product_image: '상품 이미지 업로드',
  delete_product: '상품 삭제',
  restore_product: '상품 복구',
  unpublish_product: '상품 판매 중지',
  upload_product_form: '엑셀 양식 업로드',
  list_bulk_sessions: '일괄 작업 목록 확인',
  get_bulk_session: '진행 상태 확인',
  list_bulk_session_items: '등록 항목 확인',
  decide_bulk_conflict: '충돌 항목 처리',
  approve_bulk_session: '등록 승인 요청',
  publish_bulk_session: '일괄 발행 요청',
  list_bulk_session_images: '첨부 이미지 확인',
  upload_session_images: '이미지 업로드',
  retry_bulk_draft: '초안 생성 재시도',
  cancel_bulk_session: '일괄 작업 취소',
};

/**
 * 카드로 보여줄 도구. 조회 계열만 넣는다.
 *
 * 생성·수정 도구(create_product 등)를 넣으면 한 답변에 카드가 여러 장 쌓인다.
 * 특히 create_product 의 결과는 아직 이름이 없어 "새 상품" 으로 나오므로,
 * 이어서 이름을 채운 카드와 나란히 떠서 빈 상품을 하나 더 만든 것처럼 보인다.
 */
const PRODUCT_TOOLS = new Set([
  'search_products',
  'list_my_drafts',
  'get_product',
]);

export function ToolResults({
  calls,
  onNavigate,
}: { calls: ToolCall[] } & Nav) {
  if (calls.length === 0) return null;

  const cards = calls
    .filter((c) => PRODUCT_TOOLS.has(c.name))
    .map((c) => {
      const parsed = asProducts(c.result);
      if (!parsed || parsed.rows.length === 0) return null;
      const keyword = (c.input as { keyword?: string } | undefined)?.keyword;
      return { ...parsed, keyword, draft: c.name === 'list_my_drafts' };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  const touched = touchedProduct(calls);

  return (
    <>
      {touched && (
        <Link
          href={
            // 아직 초안이면 그 버전을 열어야 방금 채운 내용이 보인다.
            !touched.published && touched.versionId
              ? buildDraftEditPath(touched.masterId, touched.versionId)
              : `/mall/products-list/${touched.masterId}`
          }
          onClick={onNavigate}
          className={styles.moreProducts}
        >
          {touched.published ? '발행한 상품 보기' : '저장한 초안 열기'}
          <ExternalLink size={12} aria-hidden />
        </Link>
      )}
      {cards.map((c, i) => (
        <ProductCards
          key={i}
          rows={c.rows}
          total={c.total}
          keyword={c.keyword}
          draft={c.draft}
          onNavigate={onNavigate}
        />
      ))}
      <details className={styles.operations}>
        <summary>작업 내역 {calls.length}건</summary>
        <ul>
          {calls.map((call, index) => {
            const failed = Boolean(
              call.result &&
              typeof call.result === 'object' &&
              'ok' in call.result &&
              call.result.ok === false
            );
            return (
              <li key={index}>
                <span>{TOOL_LABELS[call.name] ?? '작업 처리'}</span>
                {failed && <span className={styles.operationError}>실패</span>}
              </li>
            );
          })}
        </ul>
      </details>
    </>
  );
}
