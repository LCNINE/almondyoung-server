import {
  defaultBinding,
  extractVariables,
  parseManualRecipients,
  renderVariables,
  validateTemplateForm,
} from './alimtalk';

describe('알림톡 화면 도우미', () => {
  it('본문과 버튼 링크의 변수를 순서대로 한 번씩 뽑는다', () => {
    expect(
      extractVariables('#{name}님 #{date} #{name}', [
        { linkMo: 'https://a.kr/#{id}' },
      ])
    ).toEqual(['name', 'date', 'id']);
  });

  it('값이 비면 #{변수} 를 그대로 보여 준다', () => {
    expect(
      renderVariables('#{name}님 #{date}', { name: '홍길동', date: '' })
    ).toBe('홍길동님 #{date}');
  });

  it('이름 변수는 받는 사람 이름으로, 나머지는 고정값으로 시작한다', () => {
    expect(defaultBinding('name')).toEqual({
      name: 'name',
      source: 'RECIPIENT_NAME',
    });
    expect(defaultBinding('이름')).toEqual({
      name: '이름',
      source: 'RECIPIENT_NAME',
    });
    expect(defaultBinding('date')).toEqual({
      name: 'date',
      source: 'FIXED',
      value: '',
    });
  });

  it('카카오 규격을 어기면 이유를 모두 돌려준다', () => {
    const errors = validateTemplateForm(
      {
        templateCode: '한글코드',
        templateName: '',
        templateContent: 'a'.repeat(1301),
        categoryCode: '',
        buttons: [
          { name: '열네 글자를 넘는 아주 긴 버튼 이름', linkMo: 'example.com' },
        ],
      },
      true
    );
    expect(errors).toHaveLength(6);
  });

  it('수정할 때는 코드를 검사하지 않는다', () => {
    expect(
      validateTemplateForm(
        {
          templateCode: '',
          templateName: '안내',
          templateContent: '본문',
          categoryCode: '999999',
          buttons: [],
        },
        false
      )
    ).toEqual([]);
  });

  it('직접 입력은 한 줄에 "번호, 이름" 이고 이름은 없어도 된다', () => {
    expect(
      parseManualRecipients(
        '010-1111-2222, 홍길동\n\n01033334444\n01055556666\t김 철수'
      )
    ).toEqual([
      { phone: '010-1111-2222', name: '홍길동' },
      { phone: '01033334444' },
      { phone: '01055556666', name: '김 철수' },
    ]);
  });
});
