/**
 * Event Contracts Package
 *
 * 프레임워크 독립적인 이벤트 정의와 타입 시스템
 */

// Type System
export * from './types';

// Stream Definitions
export * from './streams';

// Stream Registry (topic → StreamConfig)
// `streams/index.ts` 가 아니라 여기서 내보낸다 — streams/index.ts 에 두면 순환 import 가 된다.
export * from './streams/registry';
