// 체크아웃은 Medusa 를 전부 no-store 로 읽으므로 무효화할 캐시가 없다. 이식 코드의
// revalidateTag 호출을 여기로 흘려보내 no-op 으로 만든다 — storefront 원본과의 diff 를
// 줄이려고 호출 자체는 남겨 둔다. (Next 16 의 next/cache revalidateTag 는 인자가 2개다.)
export const revalidateTag = (_tag: string): void => {}
