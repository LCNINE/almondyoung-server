-- 기존 파일은 모두 테넌트 1(아몬드영)의 것이다. 테넌트 1 의 id 는 테넌트 목록(TENANT_LIST)·토큰 tenant 와 같은 문자열 '1' 이다.
-- 다시 돌려도 같은 결과가 나온다(멱등).
UPDATE "uploads" SET "tenant_id" = '1' WHERE "tenant_id" IS NULL;--> statement-breakpoint

-- 다리(expand 기간 한정): 테넌트를 아직 싣지 않는 쓰기(전환 배포 ① 의 클레임 없는 토큰, 롤링 배포 중 옛 태스크)를
-- 테넌트 1 로 채운다. 그 쓰기는 테넌트 전 버킷(env)에 들어가고, 라이브에선 그 버킷이 테넌트 1 의 버킷이다.
-- schema.ts 에는 적지 않는다 — 테넌트 id 를 코드 상수로 두지 않기 위해서다. NOT NULL 로 조이는 contract 마이그가 함께 걷어낸다.
ALTER TABLE "uploads" ALTER COLUMN "tenant_id" SET DEFAULT '1';
