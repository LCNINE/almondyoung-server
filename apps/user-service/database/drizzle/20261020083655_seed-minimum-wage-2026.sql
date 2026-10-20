-- 고시된 시간급 최저임금. 정산 화면의 «최저임금 미만» 경고에만 쓴다.
INSERT INTO "attendance_minimum_wages" ("effective_from", "hourly_wage") VALUES ('2026-01-01', 10320) ON CONFLICT DO NOTHING;
