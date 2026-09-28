import { toRecipientInputs } from './recipient-sheet';

describe('toRecipientInputs', () => {
  it('머리글로 이름·전화번호 열을 찾고 번호 빈 행은 뺀다', () => {
    expect(
      toRecipientInputs([
        ['No', '상호명', '휴대폰 번호'],
        [1, '아몬드네일', '010-1234-5678'],
        [2, '', 1098765432],
        [3, '번호없음', ''],
      ])
    ).toEqual([
      { name: '아몬드네일', phone: '010-1234-5678' },
      { name: undefined, phone: '1098765432' },
    ]);
  });

  it('전화번호 열이 없으면 알려준다', () => {
    expect(() => toRecipientInputs([['이름', '메모']])).toThrow('전화번호 열');
  });
});
