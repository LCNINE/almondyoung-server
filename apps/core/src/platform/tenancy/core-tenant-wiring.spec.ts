import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * core 테넌트 라우팅의 배선. 셋 중 하나만 빠져도 ② 에서 모든 요청이 «맥락 없음»으로 실패하거나(문·CLS),
 * 테넌트를 무시하고 DATABASE_URL 하나로 간다(라우터).
 */
const CORE = join(__dirname, '../..');
const read = (path: string) => readFileSync(join(CORE, path), 'utf-8');

describe('core 테넌트 라우팅 배선', () => {
  it('DbModule 이 테넌트 라우터를 받는다', () => {
    expect(read('app.module.ts')).toMatch(/router:\s*\{.*?useFactory:\s*coreTenantDbRouter/s);
  });

  it('루트 모듈이 요청 문을 건다', () => {
    expect(read('app.module.ts')).toMatch(/\.\.\.coreRequestTenantProviders\(\)/);
  });

  it('main.ts 가 요청마다 CLS 맥락을 연다 — 문이 맥락을 실을 저장소다', () => {
    expect(read('main.ts')).toMatch(/mountEventChainContext\(app\)/);
  });
});
