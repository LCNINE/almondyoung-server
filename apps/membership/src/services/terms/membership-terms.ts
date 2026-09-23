/**
 * 멤버십 가입 약관의 버전 목록. 「이 사람이 어느 약관에 동의했나」의 판정은 **여기 한 곳**에만 산다.
 *
 * 약관 본문은 스토어프론트(`domains/membership/components/terms-and-conditions.tsx`)에 있고,
 * 동의 기록에는 그 화면이 보여 준 버전 문자열이 남는다. 본문이 바뀌었는데 버전이 그대로면
 * 옛 버전 이름으로 새 문언에 동의한 기록이 쌓인다 — 분쟁 때 「그 버전의 문언」을 제시할 수 없다.
 * `membership-terms.spec.ts` 가 본문 파일의 해시로 이걸 막는다(파일을 고치면 버전을 올려야 통과한다).
 *
 * 옛 버전을 지우지 않는 이유: 스토어프론트와 멤버십은 따로 배포된다. 버전을 올린 서버가 먼저 뜨면
 * 옛 화면이 보낸 옛 버전 동의가 들어오는데, 그걸 거절하면 그 사이 가입이 전부 막힌다.
 * 받는 것은 «알려진» 버전이지 «최신» 버전이 아니다.
 */
export interface MembershipTermsVersion {
  version: string;
  /** 그 버전의 본문 파일 sha256. git 이력에서 이 해시를 가진 파일이 곧 그 버전의 문언이다. */
  sha256: string;
}

export const MEMBERSHIP_TERMS_VERSIONS: readonly MembershipTermsVersion[] = [
  // 제2조 멤버십 혜택 정의·연간 정산 · 제5조 미납 요금(청약철회와 같은 기준) — 정기결제 약관에만 제5조가 붙는다.
  { version: '2026-09-23', sha256: '559ce423f52c1d93ec35627d35e7e2d14b1133705cb9530c10e82c4b91777e0d' },
];

export const CURRENT_MEMBERSHIP_TERMS_VERSION = MEMBERSHIP_TERMS_VERSIONS[MEMBERSHIP_TERMS_VERSIONS.length - 1].version;

export function isKnownMembershipTermsVersion(version: string): boolean {
  return MEMBERSHIP_TERMS_VERSIONS.some((v) => v.version === version);
}
