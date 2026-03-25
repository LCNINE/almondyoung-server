// Q&A 관련 DTO 타입 정의

// 질문 상태
export const QUESTION_STATUSES = ['active', 'answered', 'deleted'] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

// 질문 카테고리
export const QUESTION_CATEGORIES = [
  'product',
  'delivery',
  'order',
  'exchange',
  'account',
  'etc',
] as const;
export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number];

// 정렬 옵션
export const QUESTION_SORT_OPTIONS = ['latest', 'oldest'] as const;
export type QuestionSortOption = (typeof QUESTION_SORT_OPTIONS)[number];

// 답변 응답 DTO
export interface AnswerDto {
  id: string;
  questionId: string;
  adminUserId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

// 질문 응답 DTO
export interface QuestionDto {
  id: string;
  userId: string;
  nickname: string;
  productId: string | null;
  category: QuestionCategory | null;
  subCategory: string | null;
  title: string;
  content: string;
  isSecret: boolean;
  status: QuestionStatus;
  mediaFileIds: string[];
  answer: AnswerDto | null;
  createdAt: string;
  updatedAt: string;
}

// 질문 목록 조회 Query DTO
export interface QnaListQuery {
  page?: number;
  limit?: number;
  productId?: string;
  category?: QuestionCategory;
  status?: QuestionStatus;
  sort?: QuestionSortOption;
  q?: string;
}

// 질문 목록 응답 DTO
export interface QnaListResponse {
  data: QuestionDto[];
  total: number;
  page: number;
  limit: number;
}

// 답변 생성 DTO
export interface CreateAnswerDto {
  content: string;
}

// 카테고리 라벨 매핑
export const CATEGORY_LABELS: Record<QuestionCategory, string> = {
  product: '상품',
  delivery: '배송',
  order: '주문',
  exchange: '교환/반품',
  account: '계정',
  etc: '기타',
};

// 상태 라벨 매핑
export const STATUS_LABELS: Record<QuestionStatus, string> = {
  active: '대기중',
  answered: '답변완료',
  deleted: '삭제됨',
};
