# Order Matching 앱 설계 문서

본 문서는 `order-matching` 앱의 설계 배경, 책임 범위, 구조를 정리합니다.

## 목차

| 문서 | 내용 |
|------|------|
| [설계 배경](./01-background.md) | 기존 설계의 문제점과 새 설계의 동기 |
| [도메인 모델](./02-domain-model.md) | 상품 매칭, 주문 변환의 핵심 개념과 데이터 모델 |
| [앱 책임 범위](./03-responsibilities.md) | order-matching 앱이 하는 일과 하지 않는 일 |
| [앱 간 통신](./04-integration.md) | 이벤트 흐름, 다른 앱과의 관계 |
| [기존 코드 마이그레이션](./05-migration-from-existing.md) | WMS/PIM의 매칭 코드 제거 계획 |
| [주문 취소 및 변경](./06-cancellation-and-modification.md) | 취소/변경 흐름, 중간 상태, race condition 대응 |
