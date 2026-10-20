// Q&A 관련 DTO 타입 정의

// 질문 상태 (백엔드 enum 미러)
export const QUESTION_STATUSES = ['active', 'answered'] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

// 어드민 목록 필터 옵션 ('deleted'는 deletedAt 기반 삭제됨 필터)
export const QUESTION_STATUS_FILTERS = ['active', 'answered', 'deleted'] as const;
export type QuestionStatusFilter = (typeof QUESTION_STATUS_FILTERS)[number];

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

// 문의 출처 — 상품 Q&A 는 category 없이, 1:1 문의는 category 필수로 들어온다
export const QUESTION_SOURCES = ['product_qna', 'inquiry'] as const;
export type QuestionSource = (typeof QUESTION_SOURCES)[number];

export const SOURCE_LABELS: Record<QuestionSource, string> = {
  product_qna: '상품 Q&A',
  inquiry: '1:1 문의',
};

export const getQuestionSource = (q: {
  category: QuestionCategory | null;
}): QuestionSource => (q.category ? 'inquiry' : 'product_qna');

// 스토어프론트 inquiry-categories.ts 미러
export const SUB_CATEGORY_LABELS: Record<
  QuestionCategory,
  Record<string, string>
> = {
  product: {
    info: '상품 정보 문의',
    restock: '재입고 문의',
    defect: '불량/파손 문의',
    etc: '기타',
  },
  delivery: {
    status: '배송 현황 문의',
    address_change: '배송지 변경',
    delay: '배송 지연',
    etc: '기타',
  },
  order: {
    cancel: '주문 취소',
    change: '주문 변경',
    payment_error: '결제 오류',
    refund: '환불 문의',
    etc: '기타',
  },
  exchange: {
    exchange_request: '교환 신청',
    return_request: '반품 신청',
    exchange_status: '교환/반품 현황',
    etc: '기타',
  },
  account: {
    info_change: '회원 정보 변경',
    withdraw: '회원 탈퇴',
    point: '적립금/포인트 문의',
    etc: '기타',
  },
  etc: {
    suggestion: '서비스 개선 제안',
    partnership: '제휴/협력 문의',
    etc: '기타',
  },
};

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
  deletedAt: string | null;
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
  source?: QuestionSource;
  status?: QuestionStatusFilter;
  sort?: QuestionSortOption;
  q?: string;
  // q 와 OR 로 묶이는 작성자 ID (콤마 구분) — 아이디·메일·전화번호로 찾은 회원
  authorIds?: string;
  userId?: string;
  createdFrom?: string;
  createdTo?: string;
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
export const STATUS_LABELS: Record<QuestionStatusFilter, string> = {
  active: '답변 대기',
  answered: '답변 완료',
  deleted: '삭제됨',
};
