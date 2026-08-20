/**
 * 고객 프로필에 저장하는 기본 배송메모 metadata 를 만든다.
 *
 * 두 가지가 이 모듈의 존재 이유다.
 *
 * 1) **공동현관 비밀번호는 저장하지 않는다.** customer.metadata 는 만료 개념이 없는 저장소라,
 *    여기 비번을 넣으면 설계상 무기한 보관이 된다. 주문·카트 쪽 비번은 배송 완료 시 파기되고
 *    늦어도 주문일+14일에 쓸려나가는데(체크아웃 고지문이 그렇게 약속한다), 고객 프로필에
 *    영구 사본이 생기면 그 약속이 무의미해진다. 옛 클라이언트가 `entrance_password` 를 실어
 *    보내와도 흘려보내지 않으며, 과거에 저장된 값이 있으면 이 요청으로 함께 파기한다.
 *
 * 2) **기존 metadata 를 스프레드하지 않는다.** Medusa 는 metadata 를 통째로 교체하지 않고
 *    `mergeMetadata` 로 병합한다(`@medusajs/utils` common/merge-metadata). 그래서 바꾸려는 키만
 *    보내면 되고, 읽어온 전체를 되돌려보내면 그 사이 다른 요청이 쓴 값을 되돌리는 race 만 는다.
 *    같은 이유로 **빈 문자열은 키 삭제**를 뜻한다 — 아래 clear 함수가 이 성질에 기댄다.
 */

export interface DefaultShippingMemoInput {
  shipping_memo_type: string;
  shipping_memo_custom?: string;
  has_entrance?: boolean;
}

// `interface` 가 아니라 `type` 이어야 한다 — TypeScript 는 type alias 에만 암묵적 인덱스
// 시그니처를 부여하므로, interface 로 두면 Medusa 의 `metadata: Record<string, unknown>` 에
// 대입할 수 없다(TS2322). 루트 type-check 는 apps/medusa 를 제외하므로 이 오류는
// `medusa build` 에서야 드러난다.
export type DefaultShippingMemoMetadata = {
  default_shipping_memo_type: string;
  default_shipping_memo_custom: string;
  default_entrance_password: string;
  default_has_entrance: boolean;
};

export function buildDefaultShippingMemoMetadata(
  input: DefaultShippingMemoInput,
): DefaultShippingMemoMetadata {
  return {
    default_shipping_memo_type: input.shipping_memo_type,
    default_shipping_memo_custom:
      input.shipping_memo_type === 'other' ? (input.shipping_memo_custom ?? '') : '',
    // 빈 문자열 = 키 삭제. 신규 저장을 막을 뿐 아니라 과거 잔류분도 청소한다.
    default_entrance_password: '',
    default_has_entrance: input.has_entrance ?? false,
  };
}

/**
 * 기본 배송메모를 지운다.
 *
 * 키를 뺀 객체를 보내는 방식은 **동작하지 않는다** — 병합이라 "없는 키"는 손대지 않는 것으로
 * 해석되어 옛 값이 그대로 남는다. 삭제하려면 각 키를 빈 문자열로 명시해야 한다.
 */
export function buildClearedDefaultShippingMemoMetadata(): Record<string, string> {
  return {
    default_shipping_memo_type: '',
    default_shipping_memo_custom: '',
    default_entrance_password: '',
    default_has_entrance: '',
  };
}
