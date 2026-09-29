import { extractVariables, missingVariables, parametersFor, renderVariables } from './template-variables';

describe('알림톡 템플릿 변수', () => {
  it('본문과 버튼 링크의 #{변수} 를 처음 나온 순서대로 한 번씩 뽑는다 (한글 이름 포함)', () => {
    expect(
      extractVariables('#{name}님, #{금액} 결제 · #{name}', [{ linkMo: 'https://x.kr/o/#{orderId}', linkPc: null }]),
    ).toEqual(['name', '금액', 'orderId']);
  });

  it('값이 없는 변수는 그대로 남겨 빠진 자리가 보이게 한다', () => {
    expect(renderVariables('#{name}님 #{amount}', { name: '홍길동' })).toBe('홍길동님 #{amount}');
  });

  it('받는 사람 이름 칸은 사람마다, 고정값은 모두 같게 채운다', () => {
    const bindings = [
      { name: 'name', source: 'RECIPIENT_NAME' as const },
      { name: 'date', source: 'FIXED' as const, value: '10월 1일' },
    ];
    expect(parametersFor(bindings, '김철수')).toEqual({ name: '김철수', date: '10월 1일' });
  });

  it('정하지 않은 변수와 빈 고정값을 빠진 것으로 본다', () => {
    expect(
      missingVariables(
        ['name', 'date', 'place'],
        [
          { name: 'name', source: 'RECIPIENT_NAME' },
          { name: 'date', source: 'FIXED', value: '  ' },
        ],
      ),
    ).toEqual(['date', 'place']);
  });
});
