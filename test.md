subscription-service/
├── schemas/                           # 모든 스키마/타입의 중앙 저장소
│   ├── entities/
│   │   ├── subscription.schema.ts    # DB 엔티티 + DTO + 타입 모두 한곳에
│   │   ├── rights.schema.ts
│   │   ├── pause.schema.ts
│   │   └── index.ts                  # 모든 스키마 re-export
│   │
│   ├── events/
│   │   └── subscription.events.ts    # 모든 이벤트 타입 정의
│   │
│   └── api/
│       └── subscription.api.ts       # API 요청/응답 타입
│

│   ├── subscription/
│   │   ├── subscription.controller.ts
│   │   ├── subscription.service.ts
│   │   └── subscription.module.ts
│   │   # 주의: 엔티티나 DTO 정의 없음! schemas에서 import만
│   │
│   └── [기타 features...]
│
└── database/
    └── migrations/                    # 스키마 변경 시 자동 생성

    GET    /subscriptions/current              # 현재 구독 상태
GET    /subscriptions/history              # 구독 이력
POST   /subscriptions/upgrade              # 업그레이드
POST   /subscriptions/downgrade            # 다운그레이드  
POST   /subscriptions/cancel               # 구독 취소
POST   /subscriptions/pause                # 일시정지 (누락된 부분)
POST   /subscriptions/resume               # 일시정지 해제
GET    /subscriptions/pause-history        # 일시정지 이력

GET    /plans                             # 전체 플랜 목록
GET    /plans/{planId}                    # 플랜 상세
GET    /tiers                             # 전체 티어 목록
GET    /tiers/{tierId}/benefits           # 티어별 혜택

GET    /users/{userId}/subscriptions/details     # 상세 구독 정보
GET    /users/{userId}/rights/all               # 모든 권리 이력
GET    /users/{userId}/events/all               # 모든 이벤트 이력

POST   /users/{userId}/subscriptions/override   # 강제 변경 (티어/기간)
POST   /users/{userId}/credits/add              # 크레딧 지급
POST   /users/{userId}/pause/reset-quota        # 일시정지 쿼터 리셋

GET    /audit-logs                              # 감사 로그
GET    /events/unpublished                      # 미발행 이벤트
POST   /events/{eventId}/republish              # 이벤트 재발행

GET    /users/{userId}/entitlements            # 권한 검증용
POST   /subscriptions/batch-check              # 벌크 구독 확인
GET    /events/stream                          # 이벤트 스트리밍 (SSE)