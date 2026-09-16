import { AI_SCOPE } from '../../platform/auth/ai-scopes';
import type { Skill, SkillTool } from '../types';
import { toolError } from '../types';

type Choice = { label: string; value: string; hint?: string };

const MAX_CHOICES = 5;

const askChoice: SkillTool = {
  definition: {
    name: 'ask_choice',
    description:
      '되물어야 할 때 사용자에게 고를 것을 제시한다. 화면에 누를 수 있는 항목으로 그려지고, 사용자가 고르면 그 value 가 다음 발화로 들어온다. ' +
      '글로 "A 인가요, B 인가요?" 라고 묻는 대신 이것을 쓴다 — 관리자가 타이핑하지 않고 한 번에 고를 수 있다. ' +
      '이 도구를 부른 뒤에는 말을 더 보태지 말고 턴을 끝낸다. 사용자가 고르기 전에는 다음 작업으로 넘어갈 수 없다.',
    input_schema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: '무엇을 고르는지 한 문장. 항목에 이미 적힌 말을 되풀이하지 않는다.',
        },
        choices: {
          type: 'array',
          description: `고를 항목. 2~${MAX_CHOICES}개. 많으면 고르기 어려워지므로 갈래를 먼저 좁힌다.`,
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: '항목에 보일 짧은 말 (한 줄)' },
              value: {
                type: 'string',
                description: '고르면 사용자가 말한 것으로 들어갈 문장. 그것만 읽고도 무엇을 하려는지 알 수 있게 쓴다.',
              },
              hint: { type: 'string', description: '항목 아래 작은 설명 (선택)' },
            },
            required: ['label', 'value'],
          },
        },
      },
      required: ['question', 'choices'],
    },
  },
  execute(input) {
    const question = (input as { question?: unknown })?.question;
    const raw = (input as { choices?: unknown })?.choices;

    if (typeof question !== 'string' || !question.trim()) {
      return Promise.resolve(toolError('question 이 필요하다.'));
    }
    if (!Array.isArray(raw) || raw.length < 2) {
      return Promise.resolve(toolError('choices 가 2개 이상 필요하다. 갈래가 하나뿐이면 묻지 말고 그냥 진행한다.'));
    }

    const choices: Choice[] = [];
    for (const item of raw.slice(0, MAX_CHOICES)) {
      const label = (item as { label?: unknown })?.label;
      const value = (item as { value?: unknown })?.value;
      if (typeof label !== 'string' || typeof value !== 'string') continue;
      const hint = (item as { hint?: unknown })?.hint;
      choices.push({
        label,
        value,
        ...(typeof hint === 'string' && hint ? { hint } : {}),
      });
    }

    if (choices.length < 2) {
      return Promise.resolve(toolError('choices 의 label 과 value 는 둘 다 문자열이어야 한다.'));
    }

    // 화면이 이 결과를 읽어 누를 항목을 그린다. 여기서 사용자의 답을 기다리지는 않는다 —
    // 모델은 턴을 끝내고, 고른 값은 다음 요청의 발화로 들어온다.
    return Promise.resolve({ ok: true, awaitingChoice: true, question, choices });
  },
};

export const interactionSkill: Skill = {
  name: 'interaction',
  scopes: [AI_SCOPE.ASSISTANT, AI_SCOPE.STOREFRONT],
  label: '되묻기',
  instructions: `## 되물을 때는 고를 것을 준다

사용자가 무엇을 원하는지 갈리면 글로 되묻지 말고 \`ask_choice\` 를 부른다.
관리자는 좁은 패널에서 타이핑하는 것보다 누르는 쪽이 빠르다.

- 좋은 예: "상품 등록해줘" → 한 건 등록인지 엑셀 일괄인지 ask_choice 로 묻는다.
- 좋은 예: 지울 대상이 여럿일 때 어느 것인지 ask_choice 로 고르게 한다.
- 쓰지 않는 경우: 갈래가 하나뿐이면 묻지 말고 그냥 한다. 되돌릴 수 없는 작업의 확인은
  ask_choice 가 아니라 각 도구의 confirmed 인자로 받는다.

ask_choice 를 부른 뒤에는 문장을 덧붙이지 않는다. 질문은 이미 항목 위에 보인다.`,
  tools: [askChoice],
};
