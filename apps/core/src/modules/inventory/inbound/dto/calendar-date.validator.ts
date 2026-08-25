// @app/shared 로 승격됨 (search 키워드 통계 DTO 도 같은 검증이 필요해서).
// 발주 DTO 들의 기존 import 경로를 지키기 위한 re-export.
export { isCalendarDate, IsCalendarDateConstraint } from '@app/shared';
