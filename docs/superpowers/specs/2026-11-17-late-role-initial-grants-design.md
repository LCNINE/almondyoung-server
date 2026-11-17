# 첫 등록 때 없던 역할에도 카탈로그 첫 부여를 준다 (#1248)

## 왜

권한 카탈로그(`libs/authorization/src/permissions/permission-catalog.ts`)의 `grantOnFirstRegistration` 은 «오늘 그 기능을 쓰는 역할»에
키가 **처음 등록될 때 한 번** 부여된다(`apps/user-service/src/api/iam/permission-catalog-sync.manager.ts`). 그 순간 역할 행이 없으면
`missingRoles` 경고만 남기고, 다음 부팅부터 그 키는 «새 키»가 아니라 다시 시도하지 않는다 — 역할이 나중에 생겨도 그 몫은 영영 안 들어간다.

역할 행은 시드(`db:seed:ref` 의 `USER_SERVICE_REFERENCE_ROLES`)가 만들고, 새 환경의 순서는 `migrate → 배포(부팅 동기화) → seed:ref` 라
동기화가 역할보다 먼저 돌 수 있다. 라이브 `logistics_worker` 에 fulfillment 권한이 0개인 것이 이 증상으로 보인다(원인은 추정 — 회수였을 수도 있다).
컷오버 뒤 물류팀이 창고 앱·스테이션으로 출고하므로 403 이 곧 작업 불가이고, 새 키(선적 입고 등)마다 같은 구멍이 생긴다.

## 목표 · 비목표 · 반목표

- 목표: 역할 행이 없을 때 등록된 키가, 그 역할이 생기면 (다음 user-service 부팅에) 그 역할에 부여된다.
- 목표: «한 번만 부여» 유지 — 한 번 준 몫은 사람이 회수해도 다시 주지 않는다.
- 비목표: 역할 생성 즉시 부여(관리자 화면·시드). 다음 부팅 때 들어간다.
- 반목표: 사람이 회수한 권한이 배포 때 되살아나는 것. 관리자가 역할 이름만으로 자기가 갖지 않은 권한을 얻는 것.

## 방식 (사용자 선택: A)

- **A (선택) — 「이미 준 몫」 기록 표.** 부팅 동기화가 (카탈로그 키 × 그 키의 첫 부여 역할) 중 지금 있는 역할이고 기록이 없는 몫만 부여하고 기록한다.
  회수돼도 기록이 남아 다시 주지 않는다. 비용은 추가 마이그 하나(expand, `migrate → deploy`).
- B — 표 없이 «역할 생성 시각 > 키 등록 시각이고 부여 없음»이면 부여. 사람이 나중에 회수하면 다음 부팅에 되살아난다. 버림.
- C — 역할을 만드는 순간 부여(`RoleAdminManager.create`·시드). 관리자 화면 경로는 권한 상승 방지(`assertGrantable`)를 우회하고,
  시드는 `scripts/` 의 raw SQL 이라 카탈로그 판정을 두 벌로 만든다. 버림.

## 설계

**표** `iam_initial_grant_deliveries` (user-service schema)

| 열 | |
|---|---|
| `permission_key` | `iam_permissions.key` FK |
| `role_id` | `roles.role_id` FK, `on delete cascade` — 역할을 지우고 같은 이름으로 다시 만들면 새 역할이라 다시 받는다 |
| `delivered_at` | 기본 `now()` |
| PK | `(permission_key, role_id)` |

**동기화** (`PermissionCatalogSyncManager.grantFirstRegistrations` 를 바꾼다)

1. 대상 = 카탈로그 전체 키(새 키만이 아니다) × `grantOnFirstRegistration`.
2. 역할 이름 → id 를 찾고, 없는 역할은 지금처럼 `missingRoles` 로 보고한다.
3. 기록이 없는 (키, 역할) 몫만 `iam_role_permissions` 에 넣고(`on conflict do nothing`) 같은 트랜잭션에서 기록도 넣는다(`on conflict do nothing` — 두 인스턴스가 함께 부팅해도 한 번).
4. 결과의 `grants` 는 이번에 새로 기록한 몫 수. deprecated 키는 대상에서 뺀다(카탈로그에 없으니 자연히 빠진다).

**기존 데이터 채우기** (같은 마이그, custom SQL) — 모든 (권한 행, 역할 행) 쌍 중 다음 하나라도 맞으면 «준 것»으로 기록한다.
카탈로그(코드)를 SQL 이 모르므로 첫 부여 대상이 아닌 쌍까지 기록되지만 해가 없다(동기화는 카탈로그 몫만 본다).

- 지금 부여돼 있다(`iam_role_permissions` 에 행이 있다).
- 키가 등록될 때 역할이 이미 있었다(`roles.created_at <= iam_permissions.registered_at`) — 그때 동기화가 줬고 그 뒤 회수된 것이다.
- 이력에 그 역할에서 그 키를 회수한 기록이 있다(`iam_audit_logs` 의 `role.permissions.replace`, `after.removed` 에 키) — 역할이 키보다 늦게 생겼어도 사람이 손으로 주고 뺀 것이다.

나머지(역할이 키보다 늦게 생겼고 부여도 회수 이력도 없음)가 이번 수정으로 다음 부팅에 부여되는 몫이다.

**사람이 만든 역할은 받지 않는다** (최종 리뷰에서 추가) — 관리자 화면(`RoleAdminManager.create`)이 만든 역할은 `role.create` 이력이 있다. 동기화는 그 역할을 몫에서 뺀다.
이름만 같으면 받게 두면, `iam.role.write`·`iam.role.assign` 을 가진 직원이 카탈로그 이름(`logistics_manager` 등)으로 빈 역할을 만들어 자기에게 붙이고
다음 부팅에 자기가 갖지 않은 권한을 얻는다(반목표). 시드가 만든 역할은 이력이 없어 받는다 — «지우고 다시 만든 역할»도 시드가 다시 만든 경우만 다시 받는다.

**관측** — 부팅 로그에 새로 준 몫을 `key→role` 로 적는다(라이브 첫 부팅에서 무엇이 들어갔는지 보이게).

**테스트** — `permission-catalog-sync.manager.spec.ts`(단위)와 `permission-catalog-sync.integration.spec.ts`(`describeIfDb`)에 회귀:
역할 없이 키 등록 → 역할 생성 → 재동기화하면 부여 / 그 뒤 회수 → 재동기화해도 안 줌 / 두 인스턴스 동시 / 역할 삭제·재생성이면 다시 받음.
마이그의 채우기 규칙 셋은 통합 스펙에서 SQL 을 직접 돌려 확인한다.

## 제약

- expand 마이그(표 추가 + 채우기) → 순서는 `migrate → deploy`. 옛 코드는 새 표를 모르고 무시한다.
- 시드가 역할을 만든 새 환경은 user-service 를 한 번 더 부팅해야 권한이 들어간다 — `missingRoles` 경고 문구에 그걸 적는다.
- 역할·부여 변경은 iam Manager 를 거친다는 규칙(ADR-0048 §24~28)의 예외는 이미 이 동기화(시스템, `granted_by` null)다. 범위를 넓히지 않는다.

## 빌더에게 남긴 것

- 마이그 이름(`--name add-initial-grant-deliveries`), 채우기 SQL 을 일반 생성 뒤 custom 마이그로 둘지 한 파일에 둘지(같은 초 충돌 주의 — 사이에 `sleep 2`).
- 리포지토리 메서드 모양.
