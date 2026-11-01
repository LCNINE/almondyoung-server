import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCREEN_REFUSAL_TEXTS } from './screen-judge';

/**
 * 화면 실측은 «200 인데 열린 게 아닌» 화면을 문구로 가린다(`screen-judge.openProblem`). 문구가 바뀌면 거절 화면을 «열렸다»로
 * 세어 초록이 거짓이 된다 — 여기서 먼저 잡는다. 문구를 바꿨으면 SCREEN_REFUSAL_TEXTS 도 함께 바꾼다.
 * «Application error» 는 Next 자체 문구라(설치된 next 안) 여기서 대조하지 않는다.
 */
const ROOT = join(__dirname, '../../..');
const SOURCES: Record<Exclude<(typeof SCREEN_REFUSAL_TEXTS)[number], 'Application error'>, string> = {
  '접근 권한이 없습니다': 'apps/admin-web/src/components/layout/forbidden-panel.tsx',
  '권한 정보를 불러오지 못했습니다': 'apps/admin-web/src/components/layout/forbidden-panel.tsx',
  '페이지를 찾을 수 없습니다': 'apps/admin-web/src/app/not-found.tsx',
  '이 주소에서 쓸 수 없는 계정입니다': 'apps/admin-web/src/app/wrong-account/page.tsx',
};

describe('화면 실측이 «열리지 않았다»로 보는 문구', () => {
  it.each(Object.entries(SOURCES))('«%s» 가 그 화면의 소스에 있다', (text, file) => {
    expect(readFileSync(join(ROOT, file), 'utf8')).toContain(text);
  });

  it('대조표가 SCREEN_REFUSAL_TEXTS 를 빠짐없이 덮는다', () => {
    expect([...Object.keys(SOURCES), 'Application error'].sort()).toEqual([...SCREEN_REFUSAL_TEXTS].sort());
  });
});
