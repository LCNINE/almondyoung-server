/**
 * @deprecated 이 파일은 하위 호환성을 위해 유지됩니다.
 * 새로운 코드에서는 ContractEventManager를 사용하세요.
 *
 * 이동 위치: apps/membership/src/services/subscription/contract-event.manager.ts
 *
 * 이유: ContractEventService는 Service가 아닌 Implementation Layer의 Manager입니다.
 * 이벤트 소싱 패턴을 위한 유틸리티 클래스로, subscription 폴더에 위치해야 합니다.
 */

export {
  ContractEventManager as ContractEventService,
  type ContractEvent,
} from './subscription/contract-event.manager';
