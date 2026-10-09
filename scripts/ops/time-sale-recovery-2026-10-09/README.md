# 2026-10-09 타임세일 사고 복구

배경·결정은 `docs/superpowers/specs/2026-10-09-time-sale-module-design.md` §1·§8.

## 전제
- 새 Medusa(타임세일 모듈 포함)가 라이브에 배포돼 있다. 확인: `GET /admin/time-sales` 가 `{ timeSales: [...] }` 를 준다.
- 백업 JSON(사고 당일 11:50 KST 추출, 라이브 데이터라 저장소에 없다). 위치는 운영자가 안다.
- Medusa secret API key(`sk_…`). Medusa 어드민 «설정 → Secret API Keys» 에서 발급하고, 끝나면 폐기한다.

## 순서
1. dry-run: `npx tsx scripts/ops/time-sale-recovery-2026-10-09/run.ts --backup <백업.json>`
   - 표의 `generalCount` 가 741·642·400·322·87·148·3 인지 본다.
2. 적용: `MEDUSA_ADMIN_API_KEY=sk_… npx tsx scripts/ops/time-sale-recovery-2026-10-09/run.ts --backup <백업.json> --medusa https://medusa.almondyoung.com --apply`
3. 어드민 타임세일 목록: 복구 6개가 「비공개」, 노몬드가 「진행중」.
4. 스토어프론트 홈: 타임세일 섹션에 노몬드 3품목만.
5. API key 폐기.
