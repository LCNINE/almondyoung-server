# 직배 개통 점검표 (K3)

입점사 직배(`drop_shipped` SKU → 입점사 상자)를 입점사 단위로 켜는 순서. 설계 `docs/superpowers/specs/2026-10-25-k3-drop-ship-supplier-shipments-design.md` §6,
결정 `docs/adr/0050-drop-ship-is-a-supplier-shipment.md`. **한 입점사는 셀메이트와 새 시스템 중 한쪽에만 있다** — 같은 주문이 두 번 가지 않게.

선행: K3 PR 1~8 이 라이브이고 contract 마이그가 적용됐다(대기 마이그 0, `npm run deploy:preflight -- --stage live`). 아래 SQL 은 전부 읽기 전용이다.

- [ ] **1. 입점사를 공급사로 등록하고 «직배»를 켠다.** 공급사 화면의 구매 설정 «직배»(`purchaseSettings.isDirectDelivery`).
  확인: `SELECT id, name FROM suppliers WHERE is_direct_delivery;` — 켠 입점사만 나와야 한다.
- [ ] **2. 그 입점사의 상품을 셀메이트에서 내린다.** 올려 둔 채로 3번 이후를 하면 같은 주문이 셀메이트와 새 시스템 양쪽으로 간다.
  확인: 셀메이트 판매 상품 목록에서 그 입점사 상품이 «판매중» 으로 남지 않았는지 사람이 본다(코드로 잴 수 없다).
- [ ] **3. SKU 를 재고 유형 «직배»(`drop_shipped`) + 그 입점사로 등록한다.** 🔴 `physical` 로 잘못 등록하면 창고 FO 가 없는 재고를 기다리며 멈춘다.
  확인(둘 다 0 행이어야 한다):
  ```sql
  -- 직배 공급사와 연결됐는데 재고 유형이 직배가 아닌 SKU
  SELECT s.id, s.stock_type
  FROM skus s
  JOIN sku_suppliers ss ON ss.sku_id = s.id
  JOIN suppliers su ON su.id = ss.supplier_id AND su.is_direct_delivery
  WHERE s.stock_type <> 'drop_shipped';

  -- 직배 SKU 인데 직배 공급사 연결이 정확히 하나가 아닌 SKU
  SELECT s.id, count(su.id) AS direct_suppliers
  FROM skus s
  LEFT JOIN sku_suppliers ss ON ss.sku_id = s.id
  LEFT JOIN suppliers su ON su.id = ss.supplier_id AND su.is_direct_delivery
  WHERE s.stock_type = 'drop_shipped'
  GROUP BY s.id
  HAVING count(su.id) <> 1;
  ```
- [ ] **4. 외부 채널(네이버·쿠팡)에 그 SKU 를 올리지 않는다.** 채널 발송은 직배를 지원하지 않는다(비목표) — 채널 주문의 직배 SKU 는 manual 로 빠진다.
  확인: 채널 연동 화면에서 그 SKU 의 매핑이 없는지 본다.
- [ ] **5. 쇼핑몰에 게시한다.** 확인: 스토어프론트에서 상품이 보이고 장바구니에 담긴다.
- [ ] **6. 첫 주문 스모크.** 소액 주문 하나로 끝까지 간다.
  1. 직배송 운영(`/order/direct-ship`) «대기» 에 입점사 상자가 뜬다.
  2. 입점사 엑셀 내려받기 — 사유를 입력한다(접속기록이 남는다). 상자가 «넘긴 것» 으로 옮겨진다.
  3. 송장 시트 올리기 → 미리보기에서 행이 맞는지 보고 → 적용.
  4. 고객 추적 화면에 택배사·송장이 뜬다. **새 택배사 8개는 추적 링크가 아직 없다(`null`)** — 링크 없이 송장번호만 보이는 게 정상이다(실물 송장으로 URL 확인 뒤 더한다).
  5. 발송 알림 문자가 간다.
  확인(읽기 전용): 해당 상자 `SELECT id, status, supplier_id, supplier_handoff_id FROM shipments WHERE supplier_id IS NOT NULL ORDER BY created_at DESC LIMIT 5;` 가 `shipped` 이고 넘김 묶음을 가리킨다.
- [ ] **7. 취소 스모크.** 소액 주문을 하나 더 넘긴 뒤 관리자 취소 → 직배송 운영 «알릴 취소» 에 행이 뜬다 → 내려받기 → 완료 표시.
  확인: `SELECT id, supplier_id, status FROM direct_ship_cancel_notices ORDER BY created_at DESC LIMIT 5;` 의 `supplier_id` 가 그 입점사이고, 완료 표시 뒤 대기에서 빠진다.

## 알아 둘 것
- 되돌리기는 상자 상세에서 한다(입점사 상자는 재고 원장을 건드리지 않는다). 못 보냄은 취소가 아니라 라인 기록이다 — 수량은 그대로 남는다.
- contract 마이그(`drop-legacy-drop-ship`) 적용 뒤 Core 를 PR 8 이전으로 롤백할 수 없다.
