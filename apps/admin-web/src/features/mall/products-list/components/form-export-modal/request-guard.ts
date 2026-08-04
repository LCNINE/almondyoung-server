// src/features/mall/products-list/components/form-export-modal/request-guard.ts
// 겹치는 접수(POST /product-forms) 요청 중 최신 것만 인정하는 순번 가드.
//
// 모달을 닫았다 바로 다시 열거나(닫기는 새 요청을 취소하지 않는다) 실패 후 "다시 시도"를
// 누르면, 이전 요청이 서버에서 여전히 처리 중일 수 있다. HTTP 응답은 요청 순서대로
// 도착한다는 보장이 없으므로, 버려진 첫 요청의 응답이 새 요청의 응답보다 늦게 도착하면
// setExportId 를 무조건 호출하는 코드는 정상적으로 받은 exportId 를 stale 값으로 덮어쓴다
// — 화면은 엉뚱한 export 를 폴링·다운로드하게 된다.
//
// 순수 상태만 다룬다: React 훅도 @/* 런타임 import 도 없어 렌더링 없이 바로 단위테스트할
// 수 있다(선례: products-list-selection-model.ts, excel-download-model.ts).

export interface FormExportRequestGuardState {
  readonly requestId: number;
}

export const initialFormExportRequestGuard: FormExportRequestGuardState = {
  requestId: 0,
};

/**
 * 새 요청을 시작하거나(모달 열림·재시도) 진행 중이던 요청을 전부 무효화할 때(모달 닫힘)
 * 부른다. 반환된 requestId 를 그 요청의 응답 콜백(onSuccess/onError)에 캡처해 두고,
 * 콜백이 실행되는 시점에 isCurrentFormExportRequest 로 "그때도 최신 요청이었는가"를
 * 확인해야 한다. 호출부는 반환된 guard 로 자신이 들고 있는 상태를 교체해야 한다 —
 * 이 함수는 인자를 변형하지 않는다.
 */
export function nextFormExportRequestId(guard: FormExportRequestGuardState): {
  guard: FormExportRequestGuardState;
  requestId: number;
} {
  const requestId = guard.requestId + 1;
  return { guard: { requestId }, requestId };
}

/** 이 requestId 가 발급된 뒤로 더 새로운 요청(또는 무효화)이 없었는지 — stale 응답 판정. */
export function isCurrentFormExportRequest(
  guard: FormExportRequestGuardState,
  requestId: number
): boolean {
  return guard.requestId === requestId;
}
