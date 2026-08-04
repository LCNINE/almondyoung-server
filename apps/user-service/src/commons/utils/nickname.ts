// 완성형 한글/영문/숫자 + `-`, `_`. 공백과 자모(ㄱ, ㅏ) 나열,
// 기호만으로 된 닉네임(`--`)을 막는다.
export const NICKNAME_PATTERN = /^(?=.*[가-힣a-zA-Z0-9])[가-힣a-zA-Z0-9_-]+$/;

export const NICKNAME_RULE_MESSAGE = '닉네임은 한글, 영문, 숫자 2~8자로 입력해주세요.';

export function isValidNickname(nickname: string): boolean {
  return nickname.length >= 2 && nickname.length <= 8 && NICKNAME_PATTERN.test(nickname);
}
