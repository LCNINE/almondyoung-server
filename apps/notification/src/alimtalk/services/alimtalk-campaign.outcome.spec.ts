import type { NhnMessageResult } from '../clients/nhn-alimtalk.client';
import { outcomeOf } from './alimtalk-campaign.reader';

const message = (over: Partial<NhnMessageResult>): NhnMessageResult => ({
  recipientSeq: 1,
  recipientNo: '01000000000',
  recipientGroupingKey: 'n1',
  messageStatus: 'COMPLETED',
  resultCode: '1000',
  resultCodeName: '성공',
  resendStatus: 'RSC02',
  resendStatusName: '대체 발송 대상 (발송 결과 실패 시, 진행)',
  ...over,
});

describe('알림톡 수신 결과 판정', () => {
  it('메시지 조회 API 의 성공(COMPLETED · 1000)은 카카오로 받은 것이다 — 대체 발송 대상 표시가 남아 있어도', () => {
    expect(outcomeOf(message({}))).toBe('kakao');
  });

  it('알림톡이 실패하고 대체 문자가 성공하면 문자로 받은 것이다', () => {
    expect(outcomeOf(message({ resultCode: '3018', resultCodeName: '실패', resendStatus: 'RSC04' }))).toBe('sms');
  });

  it('알림톡이 실패하고 대체 문자도 실패하면 못 받은 것이다', () => {
    expect(outcomeOf(message({ resultCode: '3018', resendStatus: 'RSC05' }))).toBe('failed');
  });

  it('알림톡이 실패했는데 대체 발송 대상이 아니면 못 받은 것이다', () => {
    expect(outcomeOf(message({ resultCode: '3018', resendStatus: 'RSC01' }))).toBe('failed');
  });

  it('알림톡이 실패하고 대체 문자가 진행 중이면 아직 처리 중이다', () => {
    expect(outcomeOf(message({ resultCode: '3018', resendStatus: 'RSC03' }))).toBe('inProgress');
  });

  it('NHN 이 아직 처리하지 않았으면 처리 중이다', () => {
    expect(outcomeOf(message({ messageStatus: 'READY', resultCode: null, resendStatus: null }))).toBe('inProgress');
  });

  it('웹훅 쪽 결과 코드(MRC01)로 와도 카카오로 본다', () => {
    expect(outcomeOf(message({ resultCode: 'MRC01' }))).toBe('kakao');
  });
});
