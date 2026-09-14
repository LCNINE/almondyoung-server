import type { ProductAiDraft } from './draft';
import { salesProblems } from './sales';

export function publicationProblems(draft: ProductAiDraft): string[] {
  return [
    ...new Set([
      ...salesProblems(draft.sales),
      ...(!draft.thumbnailFileId ? ['대표 이미지를 선택해 주세요.'] : []),
      ...draft.pendingItems,
    ]),
  ];
}

/** Keep the blocked reply and its continuation button on the same next step. */
export function publicationNextStep(draft: ProductAiDraft, problems = publicationProblems(draft)) {
  const problem = problems[0];
  if (!problem) return null;
  if (problem === '카테고리와 대표카테고리를 선택해 주세요.') {
    if (draft.sales?.categories.length) {
      return {
        question: '선택한 카테고리 중 어떤 것을 대표카테고리로 사용할까요?',
        label: '대표카테고리 선택하기',
        prompt: '이미 선택한 카테고리를 보여주고 그중 대표카테고리 하나를 선택할 수 있게 안내해줘.',
      };
    }
    return {
      question: '어떤 카테고리로 등록할까요? 아래에서 이 상품에 맞는 기존 카테고리 후보를 찾아볼 수 있어요.',
      label: '카테고리 후보 찾기',
      prompt: '이 상품에 맞는 기존 카테고리를 검색해서 상위 분류 이름과 함께 후보를 보여줘.',
    };
  }
  if (problem.startsWith('각 옵션에 연결할 재고') || problem.startsWith('재고는 기존 품목')) {
    return {
      question:
        '어떤 재고 품목에 연결할까요? 기존 품목을 먼저 찾아보고, 맞는 품목이 없으면 새 품목 생성 여부를 정할 수 있어요.',
      label: '기존 재고 후보 찾기',
      prompt:
        '이 상품에 연결할 기존 재고 품목을 검색해서 후보를 보여줘. 맞는 품목이 없으면 새 품목 생성에 필요한 내용을 알려줘.',
    };
  }
  return {
    question: problem,
    label: '다음 등록 단계 안내받기',
    prompt: '아직 결정하지 않은 등록 항목 하나를 정할 수 있도록 다음 질문을 해줘. 이미 정한 상품 정보는 유지해줘.',
  };
}
