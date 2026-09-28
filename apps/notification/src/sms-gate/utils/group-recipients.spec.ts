import { toGroupRecipientRows } from './group-recipients';

describe('toGroupRecipientRows', () => {
  it('휴대폰만 E.164 로 남기고 중복·안심번호·유선·빈 번호를 버린다', () => {
    const { rows, skipped } = toGroupRecipientRows([
      { name: '가게A', phone: '010-1234-5678' },
      { name: '가게A 2호점', phone: '01012345678' },
      { name: '안심번호', phone: '0507-1234-5678' },
      { name: '유선', phone: '02-123-4567' },
      { name: '빈번호', phone: '' },
      { name: '  ', phone: '+82 10 9876 5432' },
    ]);
    expect(rows).toEqual([
      { name: '가게A', phone: '+821012345678' },
      { name: '5432', phone: '+821098765432' },
    ]);
    expect(skipped).toBe(4);
  });
});
