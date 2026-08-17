import { buildCreatePayload, buildUpdatePayload, type SalesChannelFormState } from './form-payload';

/**
 * 이 화면으로는 판매채널을 만든 적이 없다 — 폼이 `site` 를 아예 안 보내고 `type` 에 site 어휘를
 * 실어 보내 항상 400 이었다 (#649 결함 1). admin-web 은 컴포넌트 테스트가 불가능하므로 payload
 * 조립을 순수 함수로 뽑아 여기서 못 박는다.
 */
describe('판매채널 폼 payload', () => {
  function form(overrides: Partial<SalesChannelFormState> = {}): SalesChannelFormState {
    return {
      site: 'naver',
      type: 'MARKETPLACE',
      name: '네이버 스마트스토어',
      memo: '',
      feeRate: '',
      smartstoreUrl: '',
      companyCode: '',
      shipperName: '',
      shipperPhone: '',
      shipperZip: '',
      shipperAddress: '',
      isActive: true,
      ...overrides,
    };
  }

  describe('buildCreatePayload', () => {
    it('site 와 type 을 각각 실어 보낸다', () => {
      const payload = buildCreatePayload(form());

      expect(payload).not.toBeNull();
      expect(payload!.site).toBe('naver');
      expect(payload!.type).toBe('MARKETPLACE');
      expect(payload!.name).toBe('네이버 스마트스토어');
    });

    it('type 을 안 고르면 ONLINE 을 기본으로 보낸다', () => {
      const payload = buildCreatePayload(form({ type: '' }));

      expect(payload!.type).toBe('ONLINE');
    });

    it('site 가 비면 제출하지 않는다', () => {
      expect(buildCreatePayload(form({ site: '' }))).toBeNull();
    });

    it('이름이 비면 제출하지 않는다', () => {
      expect(buildCreatePayload(form({ name: '  ' }))).toBeNull();
    });

    it('site 어휘 밖의 값은 제출하지 않는다', () => {
      // 옛 프런트 상수가 쓰던 값. 서버가 400 을 내기 전에 여기서 끊는다.
      expect(buildCreatePayload(form({ site: 'naver_smartstore' }))).toBeNull();
    });

    it('빈 부가 정보는 config 에 넣지 않는다', () => {
      const payload = buildCreatePayload(form());

      expect(payload!.config).toEqual({});
    });

    it('출고지는 한 필드라도 차면 통째로 싣는다', () => {
      const payload = buildCreatePayload(form({ shipperName: '부천창고' }));

      expect(payload!.config!.shipper).toEqual({
        name: '부천창고',
        phone: '',
        zipcode: '',
        address: '',
      });
    });

    it('수수료율은 숫자로 바꿔 싣는다', () => {
      const payload = buildCreatePayload(form({ feeRate: '5.5' }));

      expect(payload!.config!.feeRate).toBe(5.5);
    });
  });

  describe('buildUpdatePayload', () => {
    it('site 를 보내지 않는다 — 채널 정체는 만든 뒤 바꿀 수 없다', () => {
      const payload = buildUpdatePayload(form());

      expect(payload).not.toHaveProperty('site');
    });

    it('활성 여부를 싣는다', () => {
      expect(buildUpdatePayload(form({ isActive: false })).isActive).toBe(false);
    });
  });
});
