import { createHash } from 'crypto';

const ADJECTIVES = [
  '귀여운', '반짝이는', '포근한', '상큼한', '달콤한', '용감한', '느긋한', '씩씩한',
  '수줍은', '명랑한', '따뜻한', '싱그러운', '말랑한', '다정한', '엉뚱한', '졸린',
];

const NOUNS = [
  '아몬드', '호두', '땅콩', '캐슈넛', '피스타치오', '마카다미아', '헤이즐넛', '밤',
  '다람쥐', '토끼', '고양이', '강아지', '펭귄', '판다', '수달', '햄스터',
];

/**
 * 공개 응답에 실명 대신 내보내는 닉네임. 출품작 id 로 정해지므로 새로고침해도 같다.
 * 어드민은 이 닉네임 옆에 `userId` 로 붙인 회원 정보를 같이 보여준다.
 */
export function authorNickname(entryId: string): string {
  const hash = createHash('sha256').update(entryId).digest();
  const adjective = ADJECTIVES[hash[0] % ADJECTIVES.length];
  const noun = NOUNS[hash[1] % NOUNS.length];
  const number = (hash.readUInt16BE(2) % 99) + 1;
  return `${adjective} ${noun} #${number}`;
}
