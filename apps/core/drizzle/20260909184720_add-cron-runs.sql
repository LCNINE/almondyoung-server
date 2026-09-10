-- #821: 크론 «주기당 한 번» 선점 기록. 앱마다 같은 모양 (libs/cron-once/src/cron-runs.schema.ts).
--
-- generate 가 함께 뽑아낸 banners.list_* ADD COLUMN · banner_groups.category DROP NOT NULL 은 여기서 뺐다 —
-- 그 셋은 이미 적용된 85(add-banner-list-fields)·87(make-banner-group-category-nullable) 의 문장 그대로다.
-- 88 스냅샷이 #810 갈래의 컬럼 변경을 담지 않은 채 머지돼(#593 과 같은 스냅샷 체인 결함) 이 마이그레이션의
-- 스냅샷(20260909184720)이 처음으로 둘의 합집합을 담는다. 그래서 SQL 은 cron_runs 만이 맞다.
CREATE TABLE "cron_runs" (
	"name" varchar(100) NOT NULL,
	"period_at" timestamp with time zone NOT NULL,
	"claimed_by" varchar(100) NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" varchar(20),
	CONSTRAINT "cron_runs_name_period_at_pk" PRIMARY KEY("name","period_at")
);
