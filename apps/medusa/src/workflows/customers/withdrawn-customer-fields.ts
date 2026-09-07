/**
 * 탈퇴 회원의 Medusa 고객 행에 쓸 익명화 값.
 *
 * user-service `anonymizeIdentity` 와 같은 규칙으로 치환한다. 이메일이 유일 제약을 가지므로, 치환해야
 * 같은 주소로 재가입한 사람이 새 고객을 만들 수 있다. 토큰이 userId 에서 결정적으로 나오므로 재시도가
 * 새 주소를 만들지 않는다.
 *
 * 하드 삭제(`deleteCustomers`)를 쓰지 않는 이유: `order` 는 `customer` 를 FK 로 참조하지 않아 주문 자체는
 * 남지만, 고객 행이 사라지면 주문과 사람의 연결이 끊겨 전자상거래법상 5년 보관해야 하는 계약·결제 기록을
 * 주체 기준으로 찾을 수 없게 된다. 반대로 행을 그대로 두면 이름·이메일이 남아 "탈퇴 시 지체 없이 파기"
 * 약속을 어긴다. 그래서 식별정보만 지우고 행은 남긴다 (2026-09-02 `b2ccb0c58`).
 */
export type WithdrawnCustomerUpdate = {
  email: string;
  first_name: string;
  last_name: null;
  phone: null;
  company_name: null;
  metadata: Record<string, unknown>;
};

export function withdrawnEmailFor(almondUserId: string): string {
  const token = almondUserId.replace(/-/g, '');
  return `withdrawn_${token}@deleted.invalid`;
}

export function buildWithdrawnCustomerUpdate(
  almondUserId: string,
  existingMetadata: Record<string, unknown> | null | undefined,
  now: Date = new Date(),
): WithdrawnCustomerUpdate {
  return {
    email: withdrawnEmailFor(almondUserId),
    first_name: '탈퇴회원',
    last_name: null,
    phone: null,
    company_name: null,
    metadata: { ...(existingMetadata ?? {}), almond_user_id: null, withdrawn_at: now.toISOString() },
  };
}
