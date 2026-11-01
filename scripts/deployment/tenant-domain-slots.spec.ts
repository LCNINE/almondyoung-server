import {
  assertTenantSlotSecretsSet,
  missingTenantSlotSecrets,
  TENANT_DOMAIN_SLOTS,
  tenantDomainSlotsFor,
  tenantSlotSecretNames,
} from '../../deployments/lcnine/tenant-domain-slots';

describe('테넌트 도메인 칸', () => {
  it('칸의 Secret 이름은 사이트와 번호만 담는다 — 회사 이름이 들어갈 자리가 없다', () => {
    expect(tenantSlotSecretNames('AdminWeb', 1)).toEqual({
      domain: 'AdminWebTenantSlot1Domain',
      certArn: 'AdminWebTenantSlot1CertArn',
      zoneId: 'AdminWebTenantSlot1ZoneId',
    });
    expect(tenantSlotSecretNames('AuthWeb', 2).domain).toBe('AuthWebTenantSlot2Domain');
  });

  it('표에 없는 stage 는 칸이 없다', () => {
    expect(tenantDomainSlotsFor('dev', { live: [1] })).toEqual([]);
    expect(tenantDomainSlotsFor('live', { live: [1, 2] })).toEqual([1, 2]);
  });

  it('실제 표의 칸 번호는 stage 마다 겹치지 않는 양의 정수다 — 번호가 리소스 논리 이름이다', () => {
    for (const slots of Object.values(TENANT_DOMAIN_SLOTS)) {
      expect(slots.every((n) => Number.isInteger(n) && n > 0)).toBe(true);
      expect(new Set(slots).size).toBe(slots.length);
    }
  });

  describe('missingTenantSlotSecrets — 칸이 있는데 Secret 이 비면 배포를 시작하지 않는다', () => {
    const table = { live: [1] };

    it('칸이 있고 Secret 이 하나도 없으면 셋 다 빠졌다고 한다', () => {
      expect(missingTenantSlotSecrets('live', 'AdminWeb', {}, table)).toEqual([
        'AdminWebTenantSlot1Domain',
        'AdminWebTenantSlot1CertArn',
        'AdminWebTenantSlot1ZoneId',
      ]);
    });

    it('SST 가 넣어 준 값이 있으면 빠진 것이 없다', () => {
      const env = {
        SST_SECRET_AdminWebTenantSlot1Domain: 'd',
        SST_SECRET_AdminWebTenantSlot1CertArn: 'c',
        SST_SECRET_AdminWebTenantSlot1ZoneId: 'z',
      };
      expect(missingTenantSlotSecrets('live', 'AdminWeb', env, table)).toEqual([]);
    });

    it('빈 문자열·공백도 빠진 것이다 — 빈 별칭으로 배포가 바뀌면 테넌트 도메인이 죽는다', () => {
      const env = {
        SST_SECRET_AdminWebTenantSlot1Domain: '',
        SST_SECRET_AdminWebTenantSlot1CertArn: ' ',
        SST_SECRET_AdminWebTenantSlot1ZoneId: 'z',
      };
      expect(missingTenantSlotSecrets('live', 'AdminWeb', env, table)).toEqual([
        'AdminWebTenantSlot1Domain',
        'AdminWebTenantSlot1CertArn',
      ]);
    });

    it('칸이 없는 stage 는 아무것도 요구하지 않는다', () => {
      expect(missingTenantSlotSecrets('dev', 'AdminWeb', {}, table)).toEqual([]);
    });

    it('사이트마다 자기 Secret 만 본다 — AuthWeb 값은 lcnine-auth 앱에 있다', () => {
      expect(missingTenantSlotSecrets('live', 'AuthWeb', {}, table)).toEqual([
        'AuthWebTenantSlot1Domain',
        'AuthWebTenantSlot1CertArn',
        'AuthWebTenantSlot1ZoneId',
      ]);
    });
  });

  describe('assertTenantSlotSecretsSet — run() 맨 앞의 멈춤', () => {
    const table = { live: [1] };

    it('빠진 Secret 마다 넣는 명령을 적어 멈춘다(값은 적지 않는다)', () => {
      expect(() => assertTenantSlotSecretsSet('live', 'AuthWeb', {}, table)).toThrow(
        'npx sst secret set AuthWebTenantSlot1ZoneId <값> --stage live',
      );
    });

    it('다 들어 있으면 지나간다', () => {
      const env = {
        SST_SECRET_AuthWebTenantSlot1Domain: 'd',
        SST_SECRET_AuthWebTenantSlot1CertArn: 'c',
        SST_SECRET_AuthWebTenantSlot1ZoneId: 'z',
      };
      expect(() => assertTenantSlotSecretsSet('live', 'AuthWeb', env, table)).not.toThrow();
    });
  });
});
