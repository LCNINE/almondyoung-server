import {
  buildRecipientRevisionPayload,
  missingRecipientFields,
  type RecipientForm,
} from './recipient-revision';

/**
 * 두 가지를 못 박는다.
 *
 * 1. 공동현관 비번은 recipientSnapshot 밖의 크리덴셜이다. 폼 상태에는 나머지 수령인
 *    필드와 나란히 살지만 payload 에서는 반드시 분리돼야 한다 — 스냅샷에 섞이면 합배송
 *    그룹핑 키와 송장 멱등 해시가 크리덴셜로 오염된다.
 * 2. **비번만 고칠 때는 recipientSnapshot 을 아예 보내지 않는다.** 이 폼은 6개 키만
 *    아는데 실제 스냅샷은 sales-order 의 `personalCustomsCode` 까지 7개일 수 있다
 *    (`shipments.recipientSnapshot` 은 `salesOrder.shippingAddress` 를 그대로 복사한다).
 *    6키를 되보내면 (a) core 가 스냅샷 변경으로 보고 manifestVersion 을 올리고
 *    (b) 통관부호가 지워진다. 서버 `whitelist: true` 때문에 되보내기로는 못 지킨다.
 *
 * admin-web 은 컴포넌트 테스트가 불가능하므로 이 판정을 순수 함수로 뽑아 여기서 검증한다.
 */
describe('수령인 정정 payload', () => {
  const STORED = {
    recipientName: '홍길동',
    phone: '010-0000-0000',
    postalCode: '01234',
    roadAddress: '서울 테스트로 1',
    detailAddress: '101동 1001호',
  };

  function form(overrides: Partial<RecipientForm> = {}): RecipientForm {
    return {
      ...STORED,
      deliveryNote: '',
      entrancePassword: '',
      ...overrides,
    };
  }

  function command(overrides: Record<string, unknown> = {}) {
    return {
      expectedManifestVersion: 3,
      reason: '고객 요청',
      currentSnapshot: STORED,
      ...overrides,
    };
  }

  it('비번만 바꾸면 recipientSnapshot 을 아예 보내지 않는다', () => {
    const payload = buildRecipientRevisionPayload(
      form({ entrancePassword: '#9999' }),
      command()
    );

    expect(payload.entrancePassword).toBe('#9999');
    expect('recipientSnapshot' in payload).toBe(false);
  });

  it('통관부호가 있는 스냅샷도 비번만 정정할 때는 손대지 않는다', () => {
    const payload = buildRecipientRevisionPayload(
      form({ entrancePassword: '#9999' }),
      command({
        currentSnapshot: { ...STORED, personalCustomsCode: 'P123456789' },
      })
    );

    expect('recipientSnapshot' in payload).toBe(false);
  });

  it('저장된 배송 메모가 null 이어도 안 바뀐 것으로 본다', () => {
    const payload = buildRecipientRevisionPayload(
      form({ entrancePassword: '#9999' }),
      command({ currentSnapshot: { ...STORED, deliveryNote: null } })
    );

    expect('recipientSnapshot' in payload).toBe(false);
  });

  it('주소가 실제로 바뀌면 recipientSnapshot 을 보낸다', () => {
    const payload = buildRecipientRevisionPayload(
      form({ detailAddress: '202동 2002호' }),
      command()
    );

    expect(payload.recipientSnapshot).toEqual({
      ...STORED,
      detailAddress: '202동 2002호',
    });
  });

  it('스냅샷을 보낼 때도 비번은 그 안이 아니라 최상위 필드로 나간다', () => {
    const payload = buildRecipientRevisionPayload(
      form({ detailAddress: '202동 2002호', entrancePassword: '#9999' }),
      command()
    );

    expect(payload.entrancePassword).toBe('#9999');
    expect(JSON.stringify(payload.recipientSnapshot)).not.toContain('#9999');
    expect(payload.recipientSnapshot).toBeDefined();
    expect('entrancePassword' in (payload.recipientSnapshot ?? {})).toBe(false);
  });

  it('비번을 비워 두면 그 키 자체를 보내지 않는다 (기존 값 유지)', () => {
    const payload = buildRecipientRevisionPayload(
      form({ entrancePassword: '   ', detailAddress: '202동 2002호' }),
      command()
    );

    expect('entrancePassword' in payload).toBe(false);
  });

  it('배송 메모가 비면 키를 빼고, 나머지는 trim 해서 보낸다', () => {
    const payload = buildRecipientRevisionPayload(
      form({ recipientName: ' 김철수 ', deliveryNote: '  ' }),
      command({ reason: ' 고객 요청 ', csCaseId: '  ', note: ' 메모 ' })
    );

    expect(payload.recipientSnapshot?.recipientName).toBe('김철수');
    expect('deliveryNote' in (payload.recipientSnapshot ?? {})).toBe(false);
    expect(payload.reason).toBe('고객 요청');
    expect('csCaseId' in payload).toBe(false);
    expect(payload.note).toBe('메모');
  });

  it('배송 메모와 비번은 필수값이 아니다', () => {
    expect(missingRecipientFields(form())).toEqual([]);
  });

  it('주소 필드가 비면 필수값 누락으로 잡는다', () => {
    expect(
      missingRecipientFields(form({ phone: '  ', roadAddress: '' }))
    ).toEqual(['phone', 'roadAddress']);
  });
});
