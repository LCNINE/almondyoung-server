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

  it('와우프레스 접수 에러는 작업상태 이름으로, 와우프레스 취소는 환불 안내로 보여준다', () => {
    expect(
      describeLastError('wowpress needs attention: job error 129')
    ).toEqual([
      '와우프레스 접수 에러: 접수에러-양단면접수에러. 와우프레스 주문배송조회에서 파일재접수나 주문취소로 처리해 주세요.',
    ]);
    expect(describeLastError('wowpress needs attention: cancelled')).toEqual([
      '와우프레스에서 주문이 취소됐습니다. 주문 화면에서 이 주문을 취소해 환불해 주세요.',
    ]);
  });
});
