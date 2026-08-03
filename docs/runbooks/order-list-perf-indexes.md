# 주문 목록/대시보드 성능 인덱스 — 라이브 무중단 적용 런북

마이그레이션 `apps/core/drizzle/20260722064941_add-order-list-perf-indexes.sql` 는 주문내역/대시보드
서버 필터의 핫패스 인덱스 2개를 추가한다.

- `idx_sales_orders_order_date` (`sales_orders.order_date`) — 기간 필터·통계
- `idx_sales_order_lines_sales_order_id` (`sales_order_lines.sales_order_id`) — 구분(EXISTS)·라인 집계

## 왜 런북이 필요한가

두 테이블은 **고객 결제/주문 생성이 쓰는** 테이블이다. 일반 `CREATE INDEX` 는 빌드 동안 테이블에
**쓰기 락**을 걸어 그 사이 들어오는 주문 INSERT 를 대기시킨다(테이블이 크면 결제 지연/타임아웃).
따라서 라이브에서는 **`CREATE INDEX CONCURRENTLY`(쓰기 락 없음)로 먼저 만든 뒤** 정규 마이그레이션을
돌린다. 정규 마이그레이션은 `CREATE INDEX IF NOT EXISTS` 라 이미 존재하면 즉시 no-op 이다.

> 인덱스는 순수 성능용(unique/NOT NULL 아님)이라 빌드가 어떤 주문 데이터도 거부하지 않으며,
> 실패해도 주문 생성에는 영향이 없다(쿼리만 느려질 뿐).

## 라이브 적용 순서

1. **CONCURRENTLY 로 인덱스 선생성** (트랜잭션 밖에서, 락 없음 — psql autocommit 로 각 문장 개별 실행):

   ```bash
   psql "$LIVE_CORE_DATABASE_URL" -c 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_sales_order_lines_sales_order_id" ON "sales_order_lines" USING btree ("sales_order_id");'
   psql "$LIVE_CORE_DATABASE_URL" -c 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_sales_orders_order_date" ON "sales_orders" USING btree ("order_date");'
   ```

   - `CREATE INDEX CONCURRENTLY` 는 트랜잭션 블록 안에서 실행 불가 → **`drizzle-kit migrate` 로 실행 금지**, 위처럼 psql 단문으로.
   - 실패(`INVALID` 인덱스 잔여) 시: `DROP INDEX CONCURRENTLY IF EXISTS "<name>";` 후 재시도.

2. **정규 배포 절차의 `db:migrate` 실행** — 위에서 이미 만들었으므로 `IF NOT EXISTS` 가 no-op 처리.

3. **배포 순서**: 새 admin-web 은 서버측 필터(typeGroup/keyword/refundIssueOnly/lineTotal)를 기대하므로
   **core 배포가 admin-web 보다 먼저이거나 동시**여야 한다. (autodeploy 없음 — 수동.)

## 작은/신규/로컬 DB

굳이 CONCURRENTLY 를 먼저 안 돌려도 된다. `db:migrate` 의 `CREATE INDEX IF NOT EXISTS` 가
직접 생성한다(작은 테이블은 락 시간이 짧아 무방).
