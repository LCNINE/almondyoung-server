import { randomUUID } from 'crypto';

/** 소셜 가입 시 랜덤 닉네임용 */
const HUMOROUS_NICKNAME_PREFIXES = [
  '노는곰',
  '졸린곰',
  '상큼이',
  '달콤이',
  '똑똑이',
  '발랄이',
  '말랑이',
  '포근이',
  '톡톡이',
  '행복이',
  '귀여운',
  '꿈꾸미',
  '유쾌한',
  '즐거운',
  '신난곰',
  '웃긴곰',
  '쿨한곰',
  '별난곰',
  '멋진곰',
  '먹는판다',
  '뛰는토끼',
  '노는토끼',
  '신난판다',
];

const MAX_NICKNAME_LENGTH = 30;
const UUID_SUFFIX_LENGTH = 6;

/**
 * 소셜 가입 시 사용할 닉네임 생성 (이름 랜덤 + uuid 6자리)
 */
export function generateSocialNickname(): string {
  const prefix = HUMOROUS_NICKNAME_PREFIXES[Math.floor(Math.random() * HUMOROUS_NICKNAME_PREFIXES.length)];
  const suffix = randomUUID().replace(/-/g, '').slice(0, UUID_SUFFIX_LENGTH);
  return `${prefix}_${suffix}`.slice(0, MAX_NICKNAME_LENGTH);
}
