// 리뷰 관련 DTO 타입 정의

export const REVIEW_STATUSES = ['active', 'hidden', 'deleted'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_RATINGS = ['1', '2', '3', '4', '5'] as const;
export type ReviewRating = (typeof REVIEW_RATINGS)[number];

export const REVIEW_HAS_COMMENT_OPTIONS = ['true', 'false'] as const;
export type ReviewHasCommentOption = (typeof REVIEW_HAS_COMMENT_OPTIONS)[number];

export const REVIEW_SORT_OPTIONS = ['latest', 'oldest', 'rating_high', 'rating_low'] as const;
export type ReviewSortOption = (typeof REVIEW_SORT_OPTIONS)[number];

export interface AdminCommentDto {
  id: string;
  reviewId: string;
  adminUserId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewDto {
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
  createdAt: string;
  updatedAt: string;
  adminComment: AdminCommentDto | null;
}

export interface ReviewListQuery {
  page?: number;
  limit?: number;
  status?: ReviewStatus;
  rating?: ReviewRating;
  productId?: string;
  hasComment?: ReviewHasCommentOption;
  sort?: ReviewSortOption;
  q?: string;
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

export const STATUS_LABELS: Record<ReviewStatus, string> = {
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
