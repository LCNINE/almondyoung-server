아래는 앞서 만든 마이그레이션 프롬프트에서 `entitlements` 테이블명을 `subscription_entitlement` 로 변경한 버전입니다. 이대로 AI 마이그레이션 도구에 입력하시면, 테이블 이름·컬럼·코드 참조까지 모두 자동으로 바꿀 수 있습니다.

````
You are a migration assistant specialized in Drizzle-ORM + NestJS projects.  
The goal is to migrate our current subscription schema (subscription_tiers, subscription_plans, subscriptions, subscription_events, subscription_pauses, subscription_rights, pause_affected_rights, pause_usage_tracker, subscription_policies) to the CTO’s approved model, which consists of:

  1. subscription_contracts  
  2. subscription_entitlement  
  3. event_batches  
  4. pause_periods  
  5. pause_entitlement_voids  

You must also update all code references (import paths, relations definitions, repository queries) to use the new names and remove any stale references.

---

## 1. 테이블 및 컬럼 매핑

### 1.1 `subscription_tiers` → `tiers`
- **Rename table**: `subscription_tiers` → `tiers`  
- **Column renames**:  
  - `priority_level` → `rank`  
- **Remove columns**:  
  - `name`  
- **Keep**: `id (PK)`, `code`, `created_at`, `updated_at`

### 1.2 `subscription_plans` → `plan`
- **Rename table**: `subscription_plans` → `plan`  
- **Remove columns**:  
  - `trial_days`  
- **Keep**:  
  - `id`, `tier_id` (FK → tiers), `price`, `duration_days`, `currency`, `is_active`, `created_at`, `updated_at`

### 1.3 `subscriptions` → `subscription_contracts`
- **Rename table**: `subscriptions` → `subscription_contracts`  
- **Remove columns**:  
  - `status`, `started_at`, `previous_subscription_id`, `change_type`, `adjustment_amount`, `void_reason`, `updated_at`  
- **Add columns**:  
  - `lead_days` INT NOT NULL DEFAULT 0  
- **Keep**:  
  - `id`, `user_id` (FK → users), `plan_id` (FK → plan),  
  - `created_at` (use existing `created_at`),  
  - `next_billing_date`,  
  - `is_voided`, `voided_at`

### 1.4 `subscription_events` → `event_batches`
- **Rename table**: `subscription_events` → `event_batches`  
- **Rename columns**:  
  - `event_type` → `type` (enum)  
  - `effectiveDate` → `effective_date`  
- **Remove columns**:  
  - `user_id`, `subscription_id`, `event_payload`, `initiated_by`, `topic_name`, `publish_status`, `retry_count`  
- **Add columns**:  
  - `admin_id` (UUID)  
  - `created_at` (TIMESTAMPTZ)  
  - `effective_date` (DATE)  

### 1.5 권리 테이블 정리
- **Drop tables**:  
  - `subscription_rights`  
  - `pause_affected_rights`  
  - `pause_usage_tracker`

### 1.6 `subscription_pauses` → `pause_periods`
- **Rename table**: `subscription_pauses` → `pause_periods`  
- **Remove columns**:  
  - `subscription_id`, `status`, `actual_resumed_at`  
- **Keep**:  
  - `id`, `user_id`, `starts_at`, `ends_at`, `created_at`  

### 1.7 `pause_affected_rights` → `pause_entitlement_voids`
- **Rename table**: `pause_affected_rights` → `pause_entitlement_voids`  
- **Rename columns**:  
  - `right_id` → `entitlement_id`  
- **Keep**:  
  - `id`, `pause_id`, `original_ends_at`, `adjusted_ends_at`, `created_at`

### 1.8 `subscription_entitlement` 테이블 생성
- **Create new table** `subscription_entitlement` matching CTO ERD:  
  ```sql
  CREATE TABLE subscription_entitlement (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    tier_id UUID NOT NULL REFERENCES tiers(id),
    starts_at DATE NOT NULL,
    ends_at DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    source_batch_id UUID REFERENCES event_batches(id),
    closed_batch_id UUID REFERENCES event_batches(id),
    paused_at TIMESTAMPTZ
  );
````

---

## 2. 코드 참조 업데이트

* **Imports**:

  * `import { subscriptionRights }` → `import { subscriptionEntitlement }`
  * 기타 테이블명·파일명도 모두 신규 명칭으로 수정

* **relations(...)** 정의에서 old table names 제거, 새로운 relations 설정

* **Repository/Service**:

  * `subscription_rights`, `pauseAffectedRights`, `pauseUsageTracker` 관련 로직 삭제
  * `subscription_entitlement` 생성·조회 로직 추가

* **Enum & index 정의**:

  * 기존 enum들은 그대로 유지

---

## 3. 마이그레이션 순서 (예시)

1. 새 테이블 및 뷰 생성 (`tiers`, `plan`, `subscription_contracts`, `event_batches`, `pause_periods`, `pause_entitlement_voids`, `subscription_entitlement`)
2. 기존 데이터 **매핑 스크립트** 실행
3. Drizzle-ORM 스키마 파일, NestJS imports/relations, 서비스 코드 일괄 리팩토링
4. 테스트 및 QA 통과 확인
5. 불필요한 구 스키마(구 테이블·컬럼) Drop

Ensure that all Drizzle-ORM schema files, NestJS modules, and migration files reflect these changes consistently.

```
```
