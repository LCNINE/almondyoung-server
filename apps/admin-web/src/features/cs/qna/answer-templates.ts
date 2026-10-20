import type { QuestionCategory } from '@/lib/types/dto/qna';

// ponytail: 코드 상수. 어드민에서 편집해야 할 만큼 자주 바뀌면 ugc 에 테이블로 옮긴다
export interface AnswerTemplate {
  id: string;
  label: string;
  body: string;
}

const CUSTOMER_NAME = '{고객명}';

const GREETING = `안녕하세요, ${CUSTOMER_NAME} 고객님.\n아몬드영입니다.\n\n`;
const CLOSING =
  '\n\n더 궁금하신 점이 있으면 언제든 문의해 주세요.\n감사합니다.';

export const ANSWER_TEMPLATES: AnswerTemplate[] = [
  { id: 'default', label: '기본', body: '' },
  {
    id: 'delivery',
    label: '배송',
    body: '문의하신 주문의 배송 현황을 안내드려요.\n',
  },
  {
    id: 'order',
    label: '주문/결제',
    body: '문의하신 주문·결제 건을 확인했어요.\n',
  },
  {
    id: 'exchange',
    label: '교환/반품',
    body: '교환·반품 접수 내용을 확인했어요.\n',
  },
  {
    id: 'product',
    label: '상품',
    body: '문의하신 상품에 대해 안내드려요.\n',
  },
  {
    id: 'account',
    label: '회원/계정',
    body: '문의하신 회원 정보 건을 확인했어요.\n',
  },
];

const TEMPLATE_BY_CATEGORY: Partial<Record<QuestionCategory, string>> = {
  delivery: 'delivery',
  order: 'order',
  exchange: 'exchange',
  product: 'product',
  account: 'account',
};

export function defaultTemplateId(category: QuestionCategory | null): string {
  return (category && TEMPLATE_BY_CATEGORY[category]) || 'default';
}

export function renderAnswerTemplate(id: string, customerName: string): string {
  const template =
    ANSWER_TEMPLATES.find((t) => t.id === id) ?? ANSWER_TEMPLATES[0];
  return (GREETING + template.body + CLOSING).replaceAll(
    CUSTOMER_NAME,
    customerName
  );
}
