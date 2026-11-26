import { fillName } from '../../../apps/notification/src/sms-gate/utils/sms-body';
import { buildRows, uploadMessageBytes } from './messages';

describe('uploadMessageBytes', () => {
  it('ASCII 는 1, 한글은 2 바이트에 발송 서비스 고정 문구 33 바이트를 더한다', () => {
    expect(uploadMessageBytes('abc')).toBe(36);
    expect(uploadMessageBytes('가나')).toBe(37);
  });
});

describe('buildRows', () => {
  const member = { phone: '+821000000001', userId: 'u1', username: '가' };

  it('이름을 채우고 본문의 URL 을 수신자별 추적 링크로 바꾼다', () => {
    const [row] = buildRows('{{이름}}님 https://shop.example/p/1 확인', [member], 'https://shop.example', () => 'AAAAAAAA');

    expect(row.body).toBe('가님 https://shop.example/r/AAAAAAAA 확인');
    expect(row.links).toEqual([{ code: 'AAAAAAAA', url: 'https://shop.example/p/1' }]);
    expect(row.bytes).toBe(uploadMessageBytes(row.body));
    expect(row.recipient).toBe(member);
  });

  it('이름을 모르면 기존 대량 발송과 같은 대체 이름을 쓴다', () => {
    const [row] = buildRows(
      '{{이름}}님 https://shop.example/p/1',
      [{ phone: '+821000000005', userId: null, username: null }],
      'https://shop.example',
      () => 'BBBBBBBB',
    );

    expect(row.body).toBe(`${fillName('{{이름}}', '')}님 https://shop.example/r/BBBBBBBB`);
  });

  it('템플릿에 링크가 없으면 멈춘다', () => {
    expect(() => buildRows('{{이름}}님 안녕하세요', [member], 'https://shop.example')).toThrow('템플릿에 링크가 없습니다');
  });
});
