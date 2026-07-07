// shadcn CLI 가 생성하는 컴포넌트는 `@/lib/utils` 에서 cn 을 import 한다.
// 실제 구현은 ./ui (twMerge 기반) 에 있으므로 여기서 re-export 한다.
export { cn } from './ui';
