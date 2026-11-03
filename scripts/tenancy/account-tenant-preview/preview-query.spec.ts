import { renderPreview, splitPreview, type AccountTenantPreviewRow } from './preview-query';

const row = (over: Partial<AccountTenantPreviewRow>): AccountTenantPreviewRow => ({
  user_id: 'u-1',
  login_id: 'someone',
  operator: false,
  tenants: ['2'],
  account_tenant: '2',
  loses: [],
  outcome: 'move',
  ...over,
});

describe('account tenant preview verdict', () => {
  it('lets the backfill go when accounts only move to their one tenant and lose nothing', () => {
    const { lines, exitCode } = renderPreview(splitPreview([row({ login_id: 'acmestaff' })]));
    expect(exitCode).toBe(0);
    expect(lines).toContain('다른 테넌트 계정이 되는 계정: 1');
    expect(lines.join('\n')).toMatch(/acmestaff .*→ 테넌트 2$/m);
  });

  it('stops for a person when a moving account loses a tenant 1 membership', () => {
    const { lines, exitCode } = renderPreview(splitPreview([row({ login_id: 'acmestaff', loses: ['1'] })]));
    expect(exitCode).toBe(1);
    expect(lines.join('\n')).toMatch(/acmestaff .*→ 테넌트 2, 거둠 \[1\]/);
  });

  it('stops for a person when an account stays in tenant 1 and loses another tenant', () => {
    const kept = row({
      login_id: 'both',
      tenants: ['1', '2'],
      account_tenant: '1',
      loses: ['2'],
      outcome: 'keep-in-tenant-one',
    });
    const { lines, exitCode } = renderPreview(splitPreview([kept]));
    expect(exitCode).toBe(1);
    expect(lines).toContain('테넌트 1 에 남고 다른 테넌트의 부여·소속을 잃는 계정: 1');
    expect(lines.join('\n')).toMatch(/both .*거둠 \[2\]/);
  });

  it('says nothing is lost on an empty database', () => {
    const { lines, exitCode } = renderPreview(splitPreview([]));
    expect(exitCode).toBe(0);
    expect(lines[0]).toBe('다른 테넌트 계정이 되는 계정: 0');
  });
});
