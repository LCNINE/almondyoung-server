import {
  DEFAULT_PRODUCT_DESCRIPTION_PROMPT,
  IMAGE_DIRECTIVE_RULES,
  buildSystemPrompt,
} from './product-description-prompt';

describe('buildSystemPrompt', () => {
  it('어드민이 저장한 프롬프트를 앞에 둔다', () => {
    expect(buildSystemPrompt('커스텀 프롬프트').startsWith('커스텀 프롬프트')).toBe(
      true
    );
  });

  // 이 규칙이 빠지면 이미지가 한 장도 본문에 안 들어간다 — 편집 내용과 무관하게 항상 붙어야 한다.
  it('어드민이 이미지 규칙을 지운 프롬프트를 저장해도 규칙이 붙는다', () => {
    expect(buildSystemPrompt('이미지 얘기는 한 줄도 없는 프롬프트')).toContain(
      IMAGE_DIRECTIVE_RULES
    );
  });

  it('빈 프롬프트여도 규칙은 붙는다', () => {
    expect(buildSystemPrompt('   ')).toContain(IMAGE_DIRECTIVE_RULES);
  });

  it('기본 프롬프트에도 규칙이 붙는다', () => {
    const result = buildSystemPrompt(DEFAULT_PRODUCT_DESCRIPTION_PROMPT);
    expect(result).toContain(IMAGE_DIRECTIVE_RULES);
    expect(result).toContain('아몬드영');
  });

  // 규칙 본문에 directive 이름이 남아있는지 — 리팩터링 중 실수로 문구가 바뀌면 잡힌다.
  it('규칙이 product-image directive 를 지시한다', () => {
    expect(IMAGE_DIRECTIVE_RULES).toContain('directive');
  });
});
