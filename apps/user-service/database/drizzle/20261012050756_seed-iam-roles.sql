-- 기본 역할 표시 이름과 intern 역할.
-- 역할 행이 아직 없는 새 환경에서는 UPDATE 가 no-op 이고 시드가 같은 값을 넣는다.
-- intern 이 이미 (다른 id 로) 있으면 그대로 둔다.
UPDATE "roles" SET "display_name" = '마스터' WHERE "name" = 'master' AND "display_name" IS NULL;--> statement-breakpoint
UPDATE "roles" SET "display_name" = '관리자' WHERE "name" = 'admin' AND "display_name" IS NULL;--> statement-breakpoint
UPDATE "roles" SET "display_name" = '물류 작업자' WHERE "name" = 'logistics_worker' AND "display_name" IS NULL;--> statement-breakpoint
UPDATE "roles" SET "display_name" = '물류 관리자' WHERE "name" = 'logistics_manager' AND "display_name" IS NULL;--> statement-breakpoint
UPDATE "roles" SET "display_name" = '일반 회원' WHERE "name" = 'user' AND "display_name" IS NULL;--> statement-breakpoint
UPDATE "roles" SET "display_name" = '멤버십 회원' WHERE "name" = 'membership' AND "display_name" IS NULL;--> statement-breakpoint
INSERT INTO "roles" ("role_id", "name", "description", "display_name")
VALUES ('019d0004-0007-7000-a000-000000000007', 'intern', '조회 전용 — 개인정보는 가려진다', '인턴')
ON CONFLICT DO NOTHING;
