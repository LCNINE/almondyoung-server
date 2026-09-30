// 리뷰 관련 DTO 타입 정의

// 리뷰 상태 (백엔드 enum 미러)
export const REVIEW_STATUSES = ['active', 'hidden'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

// 어드민 목록 필터 옵션 ('deleted'는 deletedAt 기반 삭제됨 필터)
export const REVIEW_STATUS_FILTERS = ['active', 'hidden', 'deleted'] as const;
export type ReviewStatusFilter = (typeof REVIEW_STATUS_FILTERS)[number];

export const REVIEW_RATINGS = ['1', '2', '3', '4', '5'] as const;
export type ReviewRating = (typeof REVIEW_RATINGS)[number];

export const REVIEW_HAS_COMMENT_OPTIONS = ['true', 'false'] as const;
export type ReviewHasCommentOption =
  (typeof REVIEW_HAS_COMMENT_OPTIONS)[number];

export const REVIEW_SORT_OPTIONS = [
  'latest',
  'oldest',
  'rating_high',
  'rating_low',
] as const;
export type ReviewSortOption = (typeof REVIEW_SORT_OPTIONS)[number];

export interface AdminCommentDto {
  id: string;
  reviewId: string;
  adminUserId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export const REVIEW_PROVIDER_LABELS = {
  order: '주문 권한',
  admin: '관리자 권한',
  unassigned: '권한 미연결',
} as const;
export type ReviewProviderFilter = keyof typeof REVIEW_PROVIDER_LABELS;

export interface ReviewDto {
  permission?: {
    id: string;
    provider: 'order' | 'admin';
    batchId: string | null;
    grantedReason: string | null;
  } | null;
  id: string;
  userId: string | null;
  productId: string;
  rating: number;
  content: string;
  legacy_author_name: string | null;
  mediaFileIds: string[];
  helpfulCount: number;
  likeCount: number;
  dislikeCount: number;
  status: ReviewStatus;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  adminComment: AdminCommentDto | null;
  /** 관리자 응답에만 온다. almondyoung=자체 작성, admin-manual=관리자 수기 작성, 그 밖=이관 */
  sourceSystem?: string;
  /** 관리자 수기 작성분의 입력자 ID. 관리자 응답에만 온다 */
  createdByAdminUserId?: string | null;
}

/** POST /reviews/admin/reviews 요청 — 다른 채널 고객 후기를 옮겨 적는다 */
export interface AdminCreateReviewDto {
  productId: string;
  authorName: string;
  /** ISO 8601, 오프셋 포함 (예: 2026-09-01T00:00:00+09:00) */
  writtenAt: string;
  rating: number;
  content: string;
  mediaFileIds: string[];
}

/** own = 아몬드영에서 직접 작성된 리뷰, legacy = 이전 사이트에서 이관된 리뷰 */
export type ReviewSourceOption = 'own' | 'legacy';

export interface ReviewListQuery {
  hasMedia?: 'true' | 'false';
  provider?: ReviewProviderFilter;
  batchId?: string;
  page?: number;
  limit?: number;
  status?: ReviewStatusFilter;
  rating?: ReviewRating;
  productId?: string;
  hasComment?: ReviewHasCommentOption;
  sort?: ReviewSortOption;
  q?: string;
  source?: ReviewSourceOption;
  /** 출처 정확 일치 (예: admin-manual) */
  sourceSystem?: string;
  createdFrom?: string;
  createdTo?: string;
}

export interface ReviewListResponse {
  data: ReviewDto[];
  total: number;
  page: number;
  limit: number;
}

export interface UpdateReviewStatusDto {
  status: ReviewStatus;
}

export interface CreateReviewCommentDto {
  content: string;
}

export const STATUS_LABELS: Record<ReviewStatusFilter, string> = {
  active: '공개',
  hidden: '비공개',
  deleted: '삭제됨',
};

export const HAS_COMMENT_LABELS: Record<ReviewHasCommentOption, string> = {
  true: '작성됨',
  false: '미작성',
};

export const SORT_LABELS: Record<ReviewSortOption, string> = {
  latest: '최신순',
  oldest: '오래된순',
  rating_high: '별점 높은순',
  rating_low: '별점 낮은순',
};
