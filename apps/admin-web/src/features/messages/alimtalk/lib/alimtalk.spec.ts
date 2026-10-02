import {
  autoSendOutcomeLabel,
  autoSendStatusLabel,
  defaultBinding,
  extractVariables,
  failureListTitle,
  linkedTemplateNote,
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

  it('못 받은 분 제목은 전체 인원과 표시한 인원을 따로 적는다', () => {
    expect(failureListTitle(1, 1)).toBe('못 받은 분 1명');
    expect(failureListTitle(120, 50)).toBe(
      '못 받은 분 120명 (앞의 50명만 표시)'
    );
  });

  it('자동 알림에 연결된 알림톡 템플릿의 상태를 빈칸 없이 알려 준다', () => {
    expect(linkedTemplateNote({ status: 'TSC03' })).toBe(
      '승인됨. 목록의 발송 스위치로 켜고 끕니다.'
    );
    expect(linkedTemplateNote({ status: 'TSC02' })).toBe(
      '카카오 승인 전입니다. 승인 전에 켜면 알림톡이 나가지 않습니다.'
    );
    expect(linkedTemplateNote(null)).toBe(
      '카카오(NHN)에 이 코드의 템플릿이 없습니다. 켜도 알림톡이 나가지 않습니다.'
    );
  });
});

describe('자동 발송 기록 표기', () => {
  it('접수 상태: 접수됨 / 접수 실패 / 보내기 전', () => {
    expect(autoSendStatusLabel('SENT')).toBe('카카오 접수');
    expect(autoSendStatusLabel('FAILED')).toBe('접수 실패');
    expect(autoSendStatusLabel('PENDING')).toBe('보내기 전');
    expect(autoSendStatusLabel('PROCESSING')).toBe('보내기 전');
  });

  it('수신 결과: 카카오·문자 대체·못 받음·처리 중·접수 안 됨', () => {
    expect(autoSendOutcomeLabel({ outcome: 'kakao', detail: null })).toBe(
      '카카오톡으로 받음'
    );
    expect(autoSendOutcomeLabel({ outcome: 'sms', detail: null })).toBe(
      '문자로 대신 받음'
    );
    expect(
      autoSendOutcomeLabel({ outcome: 'failed', detail: '카카오톡 미사용자' })
    ).toBe('못 받음 (카카오톡 미사용자)');
    expect(autoSendOutcomeLabel({ outcome: 'inProgress', detail: null })).toBe(
      '처리 중'
    );
    expect(
      autoSendOutcomeLabel({ outcome: 'NOT_ACCEPTED', detail: '거절' })
    ).toBe('접수되지 않음 (거절)');
  });
});
