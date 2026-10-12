import { smsSegments } from './sms-segments';

describe('smsSegments', () => {
  it('70자까지는 1통, 넘으면 67자마다 1통이다', () => {
    expect(smsSegments('가'.repeat(70)).segments).toBe(1);
    expect(smsSegments('가'.repeat(71)).segments).toBe(2);
    expect(smsSegments('가'.repeat(134)).segments).toBe(2);
    expect(smsSegments('가'.repeat(135)).segments).toBe(3);
  });

  it('이모지는 2자로 센다', () => {
    expect(smsSegments('🏆').length).toBe(2);
  });

  it('대량 발송은 링크를 추적 링크 길이로 바꿔 센다', () => {
    expect(smsSegments('https://almondyoung.com/products/very-long-handle', true).length).toBe(34);
    expect(smsSegments('https://a.co', true).length).toBe(34);
  });
});
