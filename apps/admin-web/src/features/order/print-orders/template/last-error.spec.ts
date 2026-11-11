import { describeLastError } from './last-error';

describe('describeLastError', () => {
  it('아는 사유는 한글로, 모르는 사유는 원문으로 보여준다', () => {
    expect(
      describeLastError(
        'order sent but response lost — looking up by ordkey before giving up | quote down'
      )
    ).toEqual([
      '와우프레스에 주문을 보냈지만 응답을 못 받았습니다. 5분 뒤 주문 키로 와우프레스에 주문이 들어갔는지 조회합니다.',
      'quote down',
    ]);
  });

  it('와우프레스 거절은 와우프레스가 준 사유를 그대로 붙인다', () => {
    expect(
      describeLastError('wowpress rejected the order: 주소를 확인해 주세요.')
    ).toEqual([
      '와우프레스가 주문을 받지 않았습니다. 사유: 주소를 확인해 주세요.',
    ]);
  });
});
