import type { AdminCreateReviewDto } from '../../../../lib/types/dto/review';

/** ugc-service `MAX_REVIEW_MEDIA_COUNT` 와 같다 */
export const ADMIN_REVIEW_MAX_MEDIA = 5;
/** `reviews.legacy_author_name` 길이 */
export const ADMIN_REVIEW_AUTHOR_MAX = 100;

export type AdminReviewFormValues = {
  productId: string | null;
  authorName: string;
  /** KST 달력 날짜 YYYY-MM-DD */
  writtenDate: string;
  rating: number | null;
  content: string;
  mediaFileIds: string[];
};

export type AdminReviewField = keyof AdminReviewFormValues;

export type BuildAdminReviewResult =
  | { ok: true; payload: AdminCreateReviewDto }
  | { ok: false; field: AdminReviewField; message: string };

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 브라우저 시간대와 무관하게 KST 달력 날짜를 낸다 */
export function kstToday(now: Date): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 날짜만 보내면 서버가 UTC 자정으로 읽는다 — KST 자정 시각으로 보낸다 */
export function toWrittenAtIso(date: string): string {
  return `${date}T00:00:00+09:00`;
}

export function emptyAdminReviewForm(now: Date): AdminReviewFormValues {
  return { productId: null, authorName: '', writtenDate: kstToday(now), rating: null, content: '', mediaFileIds: [] };
}

const fail = (field: AdminReviewField, message: string): BuildAdminReviewResult => ({ ok: false, field, message });

export function buildAdminReviewPayload(values: AdminReviewFormValues, now: Date): BuildAdminReviewResult {
  if (!values.productId) return fail('productId', '상품을 선택해 주세요.');

  const authorName = values.authorName.trim();
  if (!authorName) return fail('authorName', '작성자명을 입력해 주세요.');
  if (authorName.length > ADMIN_REVIEW_AUTHOR_MAX) {
    return fail('authorName', `작성자명은 ${ADMIN_REVIEW_AUTHOR_MAX}자까지 입력할 수 있어요.`);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.writtenDate)) return fail('writtenDate', '작성일을 선택해 주세요.');
  if (values.writtenDate > kstToday(now)) return fail('writtenDate', '작성일은 오늘 이후로 정할 수 없어요.');

  const { rating } = values;
  if (rating === null || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return fail('rating', '별점을 선택해 주세요.');
  }

  if (!values.content.trim()) return fail('content', '리뷰 내용을 입력해 주세요.');

  if (values.mediaFileIds.length > ADMIN_REVIEW_MAX_MEDIA) {
    return fail('mediaFileIds', `사진은 ${ADMIN_REVIEW_MAX_MEDIA}장까지 올릴 수 있어요.`);
  }

  return {
    ok: true,
    payload: {
      productId: values.productId,
      authorName,
      writtenAt: toWrittenAtIso(values.writtenDate),
      rating,
      content: values.content,
      mediaFileIds: values.mediaFileIds,
    },
  };
}
