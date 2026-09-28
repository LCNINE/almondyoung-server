import { channelBody, fillSample, unknownVariables, variableNames, withChannelBody } from './render';

describe('자동 알림 본문 도우미', () => {
  it('{{변수}} 를 [변수] 로 채운다 — 공백이 있어도 발송기와 같게 인식한다', () => {
    expect(fillSample('<p>{{ userName }}님, {{amount}}원</p>')).toBe('<p>[userName]님, [amount]원</p>');
  });

  it('본문에 쓰인 변수 이름을 한 번씩만 뽑는다', () => {
    expect(variableNames('{{a}} {{b}} {{a}}')).toEqual(['a', 'b']);
  });

  it('채널별 ko 본문을 읽고, 수정하면 다른 채널·언어·필드는 그대로 둔다', () => {
    const contents = {
      EMAIL: { ko: { subject: '제목', body: '본문', metadata: { from: 'noreply' } }, en: { body: 'en' } },
      SMS: { ko: { body: '문자' } },
    };
    expect(channelBody(contents, 'EMAIL')).toMatchObject({ subject: '제목', body: '본문' });
    expect(withChannelBody(contents, 'EMAIL', { subject: '새 제목', body: '새 본문' })).toEqual({
      EMAIL: { ko: { subject: '새 제목', body: '새 본문', metadata: { from: 'noreply' } }, en: { body: 'en' } },
      SMS: { ko: { body: '문자' } },
    });
  });
});

describe('발송기와 같은 위치에서 읽고 쓴다', () => {
  it('ko.EMAIL 구조가 있으면 발송기처럼 그쪽을 먼저 읽고, 저장도 그쪽에 한다', () => {
    const contents = { ko: { EMAIL: { subject: '새 구조', body: 'A' } }, EMAIL: { ko: { body: '옛 구조' } } };
    expect(channelBody(contents, 'EMAIL')).toEqual({ subject: '새 구조', body: 'A' });
    expect(withChannelBody(contents, 'EMAIL', { subject: '수정', body: 'B' })).toEqual({
      ko: { EMAIL: { subject: '수정', body: 'B' } },
      EMAIL: { ko: { body: '옛 구조' } },
    });
  });

  it('본문이 아예 없으면 EMAIL.ko 에 새로 쓴다', () => {
    expect(withChannelBody({}, 'EMAIL', { subject: 's', body: 'b' })).toEqual({ EMAIL: { ko: { subject: 's', body: 'b' } } });
  });

  it('점 경로 변수는 첫 이름이 알려진 변수면 경고하지 않는다', () => {
    expect(unknownVariables('{{order.id}} {{typo}}', ['order'])).toEqual(['typo']);
  });
});
