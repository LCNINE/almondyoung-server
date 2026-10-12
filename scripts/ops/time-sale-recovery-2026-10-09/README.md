# 2026-10-09 타임세일 사고 복구

배경·결정은 `docs/superpowers/specs/2026-10-09-time-sale-module-design.md` §1·§8.

## 전제
- 새 Medusa(타임세일 모듈 포함)가 라이브에 배포돼 있다. 확인: `GET /admin/time-sales` 가 `{ timeSales: [...] }` 를 준다.
- 백업 JSON(사고 당일 11:50 KST 추출, 라이브 데이터라 저장소에 없다). 위치는 운영자가 안다.
- Medusa secret API key. 라이브 SST 시크릿 `MedusaApiKey`(어드민 웹 Medusa 프록시·channel-adapter 가 같이 쓰는 키)를 쓴다.
  `deployments/lcnine/services` 에서 `npx sst secret list --stage live` 로 확인한다(만료 시 `aws login --profile login`).
  ⚠️ **이 키는 폐기하지 않는다** — 폐기하면 어드민과 채널 연동이 같이 멈춘다. 따로 발급한 일회용 키를 썼을 때만 끝나고 폐기한다.

## 언제 — Medusa 배포 «직후» 바로
새 Medusa 는 타임세일을 `time_sale` 행 기준으로 보여준다. 옛 리스트(노몬드·인기 상품·복구 대상)는 아직
`time_sale` 에 연결돼 있지 않아, **배포부터 이 복구가 끝날 때까지 어드민 타임세일 목록·스토어프론트 타임세일
섹션에서 사라진다.** 그런데 price list 자체는 살아 있어 **노몬드 세일가는 계속 적용된다** — 손님은 세일
섹션 없이 세일가로 산다. 이 창을 짧게 하려고 배포가 끝나면 바로 실행한다.

## 순서
1. dry-run: `npx tsx scripts/ops/time-sale-recovery-2026-10-09/run.ts --backup <백업.json>`
   - 표의 `error` 열이 **모든 행에서 비어 있어야 한다.** 하나라도 차 있으면 `--apply` 는 거부된다.
   - `generalCount` 는 741·642·400·322·87·148·3, 합계는 아래와 같은지 본다(백업에서 재구성한 값).

     | 대상 | 일반 품목 | 일반 합계 | 멤버십 품목 | 멤버십 합계 |
     |---|---|---|---|---|
     | 복구 ① 741품목 | 741 | 3162060 | 741 | 2143440 |
     | 복구 ② 642품목 | 642 | 4370450 | 642 | 2580750 |
     | 복구 ③ 400품목 | 400 | 2737810 | 400 | 1852740 |
     | 복구 ④ 322품목 | 322 | 2672940 | 322 | 1883370 |
     | 복구 ⑤ 87품목 | 87 | 472850 | 87 | 186190 |
     | 인기 상품 타임 세일 | 148 | 353010 | 148 | 213120 |
     | 노몬드 펌제 글루 출시 타임 세일 | 3 | 22000 | 3 | 13550 |
2. 적용: `MEDUSA_ADMIN_API_KEY=<MedusaApiKey 값> npx tsx scripts/ops/time-sale-recovery-2026-10-09/run.ts --backup <백업.json> --medusa https://medusa.almondyoung.com --apply`
   - 같은 이름의 세일이 이미 있으면 만들지 않는다. 재실행해도 된다.
   - 옛 리스트 삭제는 그룹(노몬드 / 인기 상품)마다 대체 세일을 새로 읽어 상태·개수·합계·품목별 금액을 대조한 뒤에만 한다. 대조가 어긋나면 그 그룹만 건너뛰고 `!!` 경고를 찍으며 종료 코드 1 로 끝난다. 경고가 나오면 어드민에서 대체 세일을 확인하고 재실행한다.
   - 옛 리스트가 이미 지워져 404 가 나오면 「이미 삭제됨」으로 기록하고 넘어간다.
3. 어드민 타임세일 목록: 복구 6개가 「비공개」, 노몬드가 「진행중」.
4. 스토어프론트 홈: 타임세일 섹션에 노몬드 3품목만.
5. 연결 안 된 기간형 sale 리스트 확인(읽기 전용, Medusa DB). **0행이어야 한다.**
   ```sql
   select pl.id, pl.title
     from price_list pl
    where pl.type = 'sale'
      and pl.deleted_at is null
      and (pl.starts_at is not null or pl.ends_at is not null)
      and pl.id not in (
        select price_list_id from timesale_time_sale_pricing_price_list where deleted_at is null
      );
   ```
   - 이런 리스트는 **가격은 적용되는데 어떤 화면에도 안 보인다** — 어드민 타임세일 목록에도, 겹침 검사에도
     안 잡혀서 손님만 그 가격에 산다.
   - 0이 아니면: 나온 `id`·`title` 을 백업과 대조해 무엇인지 확인한다. 이 복구의 대상(위 표·`run.ts` 의
     `TARGETS`/`NOMOND`)인데 남아 있으면 `!!` 경고 때문일 것이다 — 대체 세일을 확인하고 재실행한다.
     그 밖의 것이면 필요 없는 리스트는 Medusa 어드민 «가격 목록» 에서 지우고, 살려야 하는 것은 같은
     품목·가격의 타임세일로 다시 만든 뒤(어드민 타임세일 화면) 옛 리스트를 지운다. 다시 돌려 0행을 확인한다.
6. 일회용 키를 따로 발급해 썼다면 폐기한다. 공용 `MedusaApiKey` 는 폐기하지 않는다.
