import { BadRequestException } from '@nestjs/common';
import { readPiiExportReason } from './pii-export-reason';

describe('readPiiExportReason', () => {
  it.each([null, '', '%E0%A4', encodeURIComponent('1234'), encodeURIComponent('가'.repeat(201))])(
    '%p 는 400',
    (value) => {
      expect(() => readPiiExportReason(value)).toThrow(BadRequestException);
    },
  );
  it('메시지는 인터셉터와 같다', () => {
    expect(() => readPiiExportReason(null)).toThrow('개인정보 내보내기 사유를 5~200자로 입력하세요');
  });
  it('디코딩하고 앞뒤 공백을 지운다', () => {
    expect(readPiiExportReason(encodeURIComponent('입점사 발송 요청'))).toBe('입점사 발송 요청');
    expect(readPiiExportReason(encodeURIComponent('  입점사 발송 요청  '))).toBe('입점사 발송 요청');
  });
  it('200자는 통과', () => {
    expect(readPiiExportReason(encodeURIComponent('가'.repeat(200)))).toHaveLength(200);
  });
});
