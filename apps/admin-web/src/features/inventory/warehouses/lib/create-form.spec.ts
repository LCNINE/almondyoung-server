import { emptyCreateWarehouseForm, toCreateWarehousePayload } from './create-form';

describe('창고 만들기 폼', () => {
  it('이름·타입·위치를 그대로 보낸다(앞뒤 공백은 뗀다)', () => {
    expect(
      toCreateWarehousePayload({ name: '  제1 창고 ', type: 'overseas', location: ' 인천 ' })
    ).toEqual({ ok: true, payload: { name: '제1 창고', type: 'overseas', location: '인천' } });
  });

  it('위치가 비면 보내지 않는다', () => {
    expect(
      toCreateWarehousePayload({ ...emptyCreateWarehouseForm(), name: '제1 창고', location: '   ' })
    ).toEqual({ ok: true, payload: { name: '제1 창고', type: 'domestic' } });
  });

  it('이름이 비면 막는다', () => {
    expect(toCreateWarehousePayload({ ...emptyCreateWarehouseForm(), name: '  ' })).toEqual({
      ok: false,
      error: '창고 이름을 입력하세요.',
    });
  });
});
