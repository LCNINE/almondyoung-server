import { interactionSkill } from '../interaction/skill';
import { SKILLS, buildSystemPrompt, buildToolDefinitions, runTool, skillsFor } from '../registry';
import type { SkillContext } from '../types';

const askChoice = interactionSkill.tools.find((t) => t.definition.name === 'ask_choice')!;

const ctx: SkillContext = {
  coreHeaders: () => Promise.resolve({}),
  coreApiUrl: 'http://core',
  fileServiceUrl: 'http://files',
  attachments: [],
};

describe('ask_choice', () => {
  it('질문과 항목을 화면이 읽을 형태로 돌려준다', async () => {
    const result = (await askChoice.execute(
      {
        question: '어떻게 등록할까요?',
        choices: [
          { label: '한 건 직접', value: '상품 하나를 직접 등록할게', hint: '폼으로 채웁니다' },
          { label: '엑셀로 여러 건', value: '엑셀 양식 주세요' },
        ],
      },
      ctx,
    )) as { ok: boolean; awaitingChoice: boolean; choices: unknown[] };

    expect(result.ok).toBe(true);
    expect(result.awaitingChoice).toBe(true);
    expect(result.choices).toHaveLength(2);
  });

  it('항목이 하나뿐이면 거절한다 — 고를 것이 없으면 묻지 말고 진행해야 한다', async () => {
    const result = (await askChoice.execute(
      { question: '이렇게 할까요?', choices: [{ label: '네', value: '응' }] },
      ctx,
    )) as { ok: boolean };

    expect(result.ok).toBe(false);
  });

  it('label·value 가 문자열이 아닌 항목은 버린다', async () => {
    const result = (await askChoice.execute(
      {
        question: '어느 쪽?',
        choices: [{ label: 'A', value: 'a' }, { label: 'B' }, { value: 'c' }],
      },
      ctx,
    )) as { ok: boolean };

    // 살아남은 항목이 하나뿐이라 고를 수 없다.
    expect(result.ok).toBe(false);
  });

  it('도구 목록과 시스템 프롬프트에 실린다', () => {
    expect(buildToolDefinitions(['ai.assistant.use']).map((t) => t.name)).toContain('ask_choice');
    // 기존 지시문이 글로 되묻게 하면 모델이 이 도구를 안 쓴다.
    expect(buildSystemPrompt(['ai.assistant.use'])).toContain('ask_choice');
  });

  it('파괴적 도구가 아니다 — 확인 게이트가 붙으면 되묻기가 두 턴이 된다', () => {
    expect(askChoice.destructive).toBeFalsy();
  });
});

describe('저장 전 빈 칸 확인', () => {
  const prompt = buildSystemPrompt(['ai.assistant.use']);

  // 요약에 "상세 내용 없음" 이라고 적어만 두고 그대로 저장하려 들었다.
  // 비면 무슨 일이 생기는지 알려주고 고르게 해야 한다.
  it.each([
    ['상세 내용', 'description'],
    ['대표 이미지', 'thumbnailFileId'],
    ['공급가', 'supplyPrice'],
    ['카테고리', 'categoryIds'],
  ])('%s 가 비었을 때 짚으라고 지시한다', (_label, field) => {
    expect(prompt).toContain(field);
  });

  it('발행은 초안보다 세게 확인하라고 지시한다', () => {
    expect(prompt).toContain('발행할 때는 더 세게 짚는다');
  });
});

describe('권한별 도구 격리', () => {
  const adminTools = buildToolDefinitions(['ai.assistant.use']).map((t) => t.name);

  it('어시스턴트 사용 권한이 있으면 스킬 셋을 모두 받는다', () => {
    expect(skillsFor(['ai.assistant.use']).map((s) => s.name)).toEqual(SKILLS.map((s) => s.name));
    expect(SKILLS).toHaveLength(3);
  });

  it('어드민은 상품 도구를 받는다', () => {
    expect(adminTools).toEqual(expect.arrayContaining(['delete_product', 'set_product_price', 'ask_choice']));
  });

  it('권한이 없으면 도구도 지시문도 비운다', () => {
    expect(buildToolDefinitions([])).toEqual([]);
    expect(skillsFor([])).toEqual([]);
    // 부를 수 없는 도구의 사용법을 읽히면 모델이 그것을 부르려다 헛돈다.
    expect(buildSystemPrompt([])).not.toContain('delete_product');
    expect(buildSystemPrompt([])).not.toContain('상품에 대한 글쓰기는 업무다');
  });

  // 어시스턴트 사용 권한이 아닌 다른 권한으로는 도구가 열리지 않는다.
  it('다른 권한만으로는 아무 도구도 받지 않는다', () => {
    expect(skillsFor(['catalog.product.write'])).toEqual([]);
  });

  it('권한 없이는 상품 도구를 실행할 수 없다 — 이름을 직접 불러도', async () => {
    const result = (await runTool('delete_product', { masterId: 'm1', confirmed: true }, ctx, [])) as {
      ok: boolean;
      error?: string;
    };

    expect(result.ok).toBe(false);
    expect(result.error).toContain('알 수 없는 도구');
  });
});

describe('업무 범위', () => {
  const prompt = buildSystemPrompt(['ai.assistant.use']);

  // 포켓몬 타입과 저녁 레시피를 성실히 답했다. 알고 있어도 답하면 안 되는 자리다.
  it('업무 밖 질문에 답하지 말라고 지시한다', () => {
    expect(prompt).toContain('업무 밖은 하지 않는다');
    expect(prompt).toContain('알고 있더라도 답하지 않는다');
  });

  // 주제 목록으로 거르면 목록에 없는 주제가 왔을 때 또 답한다.
  it('주제 목록이 아니라 근거의 출처로 가르게 한다', () => {
    expect(prompt).toContain('가르는 기준은 주제가 아니라 출처다');
    expect(prompt).toContain('도구를 하나도 부르지 않고 머릿속 지식만으로');
  });

  // 시각 블록을 사용자의 말로 읽고 "현재 시각: …" 을 먼저 뱉었다.
  // 스킬이 늘 때마다 공통 지시문에 예외를 덧붙이면, 그 스킬을 못 쓰는 사용자에게도 실린다.
  it('예외는 공통 지시문이 아니라 스킬이 자기 자리에 적게 한다', () => {
    expect(prompt).toContain('예외는 여기 적지 않고 그 스킬이 자기 자리에');
    // 상품 글쓰기 예외는 product-catalog 스킬 쪽에 있다.
    expect(prompt).toContain('상품에 대한 글쓰기는 업무다');
  });

  // 도구는 늘어나는데 문구는 안 따라와서 곧 거짓말이 된다.
  it('거절 문구에 할 수 있는 일을 나열하지 않는다', () => {
    expect(prompt).toContain('할 수 있는 일을 문구에 나열하지 않는다');
    expect(prompt).not.toContain('상품 등록·수정·엑셀 일괄 작업을 도와드릴 수 있어요');
  });

  // 지금은 상품만 다루지만 어드민 업무 전반으로 넓힐 것이다.
  it('업무 범위를 특정 도메인으로 못박지 않는다', () => {
    expect(prompt).toContain('무엇이 업무인지는 아래 스킬 지시문이 정하지');
  });

  it('시각 블록은 참고용이라고 못박는다', () => {
    expect(prompt).toContain('시각 정보는 참고용이다');
  });

  // "반갑습니다" 에 선택지 세 개를 내밀었다.
  it('인사에는 선택지 대신 무슨 업무인지 되묻게 한다', () => {
    expect(prompt).toContain('인사에는 인사로 답하고 되묻는다');
    expect(prompt).toContain('어떤 업무를 도와드릴까요');
  });
});
