-- 한진택배 송장 발행 방식 추가 (additive, expand-contract §5 1-PR 케이스)
-- NOTE: 생성 당시 meta 체인 복구가 함께 이루어짐 — 직전 snapshot(20260609063049)에
-- 이미 적용된 inspection 테이블(20260609030422)과 product-code partial index(20260612114656)
-- 변경이 누락되어 있어 generate 가 해당 문장들을 재생성했고, 이미 DB 에 적용된 변경이므로
-- 이 파일에서 제거함. snapshot 은 현재 schema.ts 전체를 정확히 반영한다.
ALTER TYPE "public"."invoice_method" ADD VALUE 'hanjin';
