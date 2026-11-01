import { StepRefused } from './runner';
import { addTenantToEnv, envListsTenant, removeTenantFromEnv } from './tenant-list-env';

const ONE =
  '{"id":"1","slug":"almondyoung","coreDb":"dev_core","publicBucket":"almondyoung-demo","privateBucket":"almondyoung-demo"}';
const TWO = {
  id: '2',
  slug: 'rehearsal',
  coreDb: 'core_rehearsal',
  publicBucket: 'rehearsal-public',
  privateBucket: 'rehearsal-private',
};
const TWO_JSON =
  '{"id":"2","slug":"rehearsal","coreDb":"core_rehearsal","publicBucket":"rehearsal-public","privateBucket":"rehearsal-private"}';

const env = (list: string) => `PORT=3100\nTENANT_LIST='${list}'\nTENANT_GATE_MODE=warn\n`;

describe('로컬 .env 의 TENANT_LIST 편집', () => {
  it('목록 끝에 항목을 더하고 다른 줄은 그대로 둔다', () => {
    expect(addTenantToEnv(env(`[${ONE}]`), TWO)).toBe(env(`[${ONE},${TWO_JSON}]`));
  });

  it('이미 같은 항목이 있으면 바꾸지 않는다', () => {
    const listed = env(`[${ONE},${TWO_JSON}]`);
    expect(addTenantToEnv(listed, TWO)).toBe(listed);
    expect(envListsTenant(listed, TWO)).toBe(true);
    expect(envListsTenant(env(`[${ONE}]`), TWO)).toBe(false);
  });

  it('같은 id 가 다른 값으로 있으면 덮지 않고 거절한다 — «안 넣었다»로도 답하지 않는다(되돌리기가 남의 테넌트를 지운다)', () => {
    const foreign = env(`[${ONE},${TWO_JSON.replace('core_rehearsal', 'core_other')}]`);
    expect(() => addTenantToEnv(foreign, TWO)).toThrow(StepRefused);
    expect(() => envListsTenant(foreign, TWO)).toThrow(StepRefused);
  });

  it('TENANT_LIST 줄이 없으면 거절한다 — 줄을 만드는 건 bootstrap 0-b 다', () => {
    expect(() => addTenantToEnv('PORT=3100\n', TWO)).toThrow(/TENANT_LIST/);
  });

  it('되돌리기는 그 id 만 뺀다. 없으면 그대로', () => {
    expect(removeTenantFromEnv(env(`[${ONE},${TWO_JSON}]`), '2')).toBe(env(`[${ONE}]`));
    expect(removeTenantFromEnv(env(`[${ONE}]`), '2')).toBe(env(`[${ONE}]`));
  });

  it('줄이 없는 파일의 되돌리기는 아무것도 안 한다', () => {
    expect(removeTenantFromEnv('PORT=3100\n', '2')).toBe('PORT=3100\n');
  });
});
