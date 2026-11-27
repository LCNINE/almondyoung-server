# Cellmate Order Collection Tools

These shared operational scripts collect live Medusa orders for Cellmate and synchronize shipped status to Medusa and Core.

- `collect-cellmate.js`: reads live Medusa orders and writes Cellmate CSV/XLSX/JSON.
- `mark-medusa-shipped.js`: sets physical Medusa order-item shipped quantities.
- `mark-core-shipped.js`: maps Medusa display IDs to Core and marks sales/fulfillment rows shipped.
- `check-add-to-delivery.js`: finds 함께 배송(add-to-delivery) orders attached to this round's orders that are paid, not shipped and missing from this round's file.

Run from `deployments/lcnine/services` inside `npx sst shell --stage live`, with the DB tunnel on `127.0.0.1:15432`:

```bash
NODE_PATH=/home/hyunji/문서/GitHub/almondyoung-server/apps/medusa/node_modules:/home/hyunji/문서/GitHub/almondyoung-server/node_modules \
DB_TUNNEL_HOST=127.0.0.1 DB_TUNNEL_PORT=15432 \
LATEST_DISPLAY_ID=<last> AWAITING_IDS=<comma-separated> INCLUDE_ALL_AWAITING=1 \
EXCLUDE_DISPLAY_IDS=<comma-separated IDs already uploaded separately> \
OUTPUT_PREFIX=cellmate-after-<last>-with-confirmed-YYYYMMDD \
OUTPUT_DIR=/home/hyunji/문서/GitHub/almondyoung-server/apps/medusa \
npx sst shell --stage live -- node ../../../scripts/ops/cellmate-local/collect-cellmate.js
```

The two shipped scripts receive `DISPLAY_IDS=...` in the same SST shell. Keep the latest handoff values in the conversation, not in this directory.

## 함께 배송 점검 (shipped 직전·직후)

`DISPLAY_IDS` 는 이번 회차 주문 display_id 다. 같은 SST shell 에서 shipped 로 바꾸기 직전과 직후에 한 번씩 돌린다.

```bash
DB_TUNNEL_HOST=127.0.0.1 DB_TUNNEL_PORT=15432 DISPLAY_IDS=<comma-separated> \
npx sst shell --stage live -- node ../../../scripts/ops/cellmate-local/check-add-to-delivery.js
```

- `함께 배송 추가분 0` 이면 그대로 진행한다.
- 나오면 출력된 `AWAITING_IDS=…` 로 `collect-cellmate.js` 를 그 주문만 다시 뽑는다. 이번 회차 부모·새 주문이 섞이지 않게 `LATEST_DISPLAY_ID` 를 아주 크게 두고 `INCLUDE_ALL_AWAITING` 는 끈다. 결과 파일 이름도 따로 둔다:

  ```bash
  LATEST_DISPLAY_ID=999999999 AWAITING_IDS=<출력된 값> INCLUDE_ALL_AWAITING=0 \
  OUTPUT_PREFIX=cellmate-add-to-delivery-YYYYMMDD-HHMM ... node ../../../scripts/ops/cellmate-local/collect-cellmate.js
  ```

  수집 제외 조건(취소·환불·입금 대기·이미 출고 등)은 그 스크립트가 그대로 건다. **결과 파일에 실제로 들어간 주문만** 셀메이트에 추가 업로드하고 그 display_id 만 shipped 로 바꾼다. 셀메이트는 송장 출력 전이면 부모와 다시 묶는다(한번만 묶음정리 꺼짐).
- 송장을 이미 출력해 따로 나간 건은 회차 보고에 `함께 배송 따로 출고 N건` 한 줄로 남긴다.

