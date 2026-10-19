import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../../../..');

// 스토어프론트에서 고를 수 있는 웹폰트가 인쇄 이미지에도 들어가는지 지킨다.
// 빠지면 화면엔 그 글꼴로 보이는데 인쇄 파일엔 Noto 로 바뀌어 나간다.
describe('아몬드템플릿 인쇄 글꼴', () => {
  it('스토어프론트 웹폰트가 모두 print-fonts.txt 에 있다', () => {
    const fonts = readFileSync(join(root, 'web/almondyoung-storefront/src/domains/almond-template/lib/fonts.ts'), 'utf8');
    const list = readFileSync(join(root, 'apps/ugc-service/print-fonts.txt'), 'utf8');
    const families = [...fonts.matchAll(/\[\s*"[^"]+",\s*"([^"]+)",\s*"[^"]+",\s*"(?:sans-serif|serif|cursive)",?\s*(?:"[^"]+",?\s*)?\]/g)].map(([, family]) => family);
    expect(families.length).toBe(34);
    const dirs = new Set(list.split('\n').map((line) => line.split('/')[0]));
    expect(families.filter((family) => !dirs.has(family.toLowerCase().replace(/ /g, '')))).toEqual([]);
  });
});
