import {
  buildRecipientRevisionPayload,
  missingRecipientFields,
  type RecipientForm,
} from './recipient-revision';

/**
 * 공동현관 비번은 recipientSnapshot 밖의 크리덴셜이다. 폼 상태에는 나머지 수령인
 * 필드와 나란히 살지만 payload 에서는 반드시 분리돼야 한다 — 스냅샷에 섞이면 합배송
 * 그룹핑 키와 송장 멱등 해시가 크리덴셜로 오염된다. admin-web 은 컴포넌트 테스트가
 * 불가능하므로 그 분리를 순수 함수로 뽑아 여기서 못 박는다.
 */
describe('수령인 정정 payload', () => {
  function form(overrides: Partial<RecipientForm> = {}): RecipientForm {
    return {
      recipientName: '홍길동',
      phone: '010-0000-0000',
      postalCode: '01234',
      roadAddress: '서울 테스트로 1',
      detailAddress: '101동 1001호',
      deliveryNote: '',
      entrancePassword: '',
      ...overrides,
    };
  }

  it('비번은 recipientSnapshot 이 아니라 최상위 필드로 나간다', () => {
    const payload = buildRecipientRevisionPayload(
      form({ entrancePassword: '#9999' }),
      {
        expectedManifestVersion: 3,
        reason: '고객 요청',
      }
    );

    expect(payload.entrancePassword).toBe('#9999');
    expect('entrancePassword' in payload.recipientSnapshot).toBe(false);
    expect(JSON.stringify(payload.recipientSnapshot)).not.toContain('#9999');
  });

  it('비번을 비워 두면 그 키 자체를 보내지 않는다 (기존 값 유지)', () => {
    const payload = buildRecipientRevisionPayload(
      form({ entrancePassword: '   ' }),
      {
        expectedManifestVersion: 3,
        reason: '주소 정정',
      }
    );

    expect('entrancePassword' in payload).toBe(false);
  });

  it('배송 메모가 비면 키를 빼고, 나머지는 trim 해서 보낸다', () => {
    const payload = buildRecipientRevisionPayload(
      form({ recipientName: ' 홍길동 ', deliveryNote: '  ' }),
      {
        expectedManifestVersion: 3,
        reason: ' 고객 요청 ',
        csCaseId: '  ',
        note: ' 메모 ',
      }
    );

    expect(payload.recipientSnapshot.recipientName).toBe('홍길동');
    expect('deliveryNote' in payload.recipientSnapshot).toBe(false);
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
