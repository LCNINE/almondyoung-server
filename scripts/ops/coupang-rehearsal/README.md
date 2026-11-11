# 쿠팡 리허설 (#1245)

쿠팡에는 시험 환경이 없고 API 키가 하나뿐이다. 컷오버 전날 밤 한 번, 사무실 PC 에서 **읽기만** 하는 수집을 돌려
실제 응답 모양을 확인하고, 가짜 값으로 바꾼 자료를 만든다. 쓰기 호출은 코드가 막는다
(`COUPANG_READ_ONLY=true` — 실행 첫 줄에 켜진다. GET 이 아닌 호출은 보내기 전에 throw).

## 원칙

- **원 응답(`<out>/raw`)에는 실제 고객 정보가 들어 있다.** 반드시 레포 밖에만 쓴다. `--out` 이 레포 안이면(심볼릭 링크 포함) 아무것도 호출하지 않고 종료 코드 2 로 끝난다.
- **원본은 가짜 값 자료를 만든 뒤 지운다.** 레포에는 가짜 값 자료만 올라간다.
- 이 스크립트는 DB·Kafka 에 닿지 않고, 상품준비중 처리(`acknowledge`)를 부르지 않는다.

## 순서

1. 쿠팡 WING 의 API 허용 IP 에 이 PC 의 공인 IP 를 추가한다.
2. 자격증명을 환경변수로 넘겨 **레포 루트에서** 실행한다.
   ```bash
   COUPANG_VENDOR_ID=… COUPANG_ACCESS_KEY=… COUPANG_SECRET_KEY=… \
     npx tsx scripts/ops/coupang-rehearsal/index.ts --out=<레포 밖 디렉터리>
   ```
   화면에 결제완료(넘겨받을 주문 수·번호), 상품준비중이면서 송장 없는 상자, 해석 실패(칸 이름), 같은 옵션 두 줄 주문,
   `CoupangOrderSource.fetchOrdersInWindow(null)` 결과 요약이 나온다. 원 응답은 `<out>/raw/NNN-*.json` (받는 즉시 쓰므로 도중에 실패해도 그때까지 받은 것은 남는다).
   31일 조회 폭이 받아들여지는지도 여기서 본다.
3. 가짜 값 자료를 만든다.
   ```bash
   npx tsx scripts/ops/coupang-rehearsal/anonymize.ts \
     --in=<out>/raw \
     --to=apps/channel-adapter/src/services/order-collection/__fixtures__/coupang
   ```
   이름·연락처·주소·이메일·배송 메모와 주문/상자/접수 번호(같은 자릿수 가짜 숫자, 같은 원값은 같은 가짜값)만 바뀌고,
   상태·수량·금액·`vendorItemId` 는 그대로다. 끝에 «바꾸지 않은 문자열 칸» 의 키 경로 목록이 나온다 — 이름·주소·연락처·메모처럼 보이는 칸이 있으면 `anonymize.ts` 에 규칙을 더해 다시 만든다. 만든 파일도 눈으로 훑어 실제 값이 남지 않았는지 확인한 뒤 커밋한다.
4. **원본을 지운다.** `<out>` 디렉터리를 통째로 삭제한다.
5. WING 에서 추가했던 IP 를 뺀다.

그 뒤: 자료로 `coupang-order-fields.spec.ts` 에 실제 모양 테스트를 더하고, 머리 주석의 추정을 확정하거나 고친다.
