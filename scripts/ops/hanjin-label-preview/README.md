# 한진 운송장 현장 키트 (#913)

한진 라벨지 위에 NS·NL·FS 세 형을 찍어 보고 **우리 라벨지가 어느 형인지**, 글자가 선인쇄 칸에 맞는지,
바코드가 읽히는지 판정한다. 합성 데이터라 개인정보는 없다.

## 1. 만든다 (개발 PC)

```bash
npx tsx scripts/ops/hanjin-label-preview/render.ts ./hanjin-kit
```

`hanjin-{ns,nl,fs}-preview.{png,zpl,compressed.zpl}` 9개와 FS 품목 7줄 견본
`hanjin-fs-items-preview{-p1.png,-p2.png,.zpl,.compressed.zpl}`(2쪽)이 나온다.

| 형 | 라벨 | 프린터에 넣는 방향 |
| --- | --- | --- |
| NS | 가로 200 × 세로 102mm | 90° 돌려 폭 102mm |
| NL | 가로 100 × 세로 102mm(샘플 비율 추정) | 그대로 폭 100mm |
| FS | 가로 123 × 세로 100mm | 270° 돌려 폭 100mm(2026-09-28 창고 라벨지로 확정) |

PNG 는 포털 [운송장 출력 Sample](https://developers.hanjin.com/printwbl) 과 나란히 놓고 보는 미리보기다
(빨간 테두리 = 바코드 자리). 폴더를 USB 등으로 창고 PC 에 옮긴다.

## 2. 프린터 준비 (창고 PC · XP-DT108B)

- 프린터가 **ZPL 로 동작**해야 한다(이 모델은 TSPL/ZPL/EPL/DPL 에뮬레이션). 명령어 언어 설정이
  자동 감지가 아니면 Xprinter 설정 도구에서 ZPL 로.
- 라벨지를 넣고 갭(용지 길이) 캘리브레이션을 한다.

## 3. 보낸다

⚠️ **warehouse-app 진단 화면으로는 이 파일을 못 보낸다** — 진단 화면은 앱에 내장된 테스트 라벨만 찍고
파일을 보내는 기능이 없다.

Windows 에서 프린터를 공유하고 파일을 공유 경로로 그대로 복사한다:

1. 설정 → 프린터 → XP-DT108B → 프린터 속성 → **공유** → 「이 프린터 공유」, 공유 이름 `XP108`
2. 키트 폴더에서 `cmd` 를 열고:

   ```bat
   copy /b hanjin-nl-preview.zpl \\localhost\XP108
   ```

SMB 공유로 들어간 작업은 RAW 로 스풀돼 드라이버 렌더링을 거치지 않는다 — warehouse-app 이 실제 인쇄에
쓰는 경로(Windows 스풀러 RAW)와 같다. **2026-09-28 기준 이 방법은 창고에서 아직 검증되지 않았다.**

안 나올 때:

| 증상 | 볼 것 |
| --- | --- |
| `copy` 가 경로를 못 찾음 | 공유 이름 오타 — `net view \\localhost` 로 확인 |
| 아무것도 안 나옴 | 프린터 대기열(스풀러)에 작업이 걸려 있는지. 오류 상태면 지우고 프린터 전원 재시작 |
| `^XA^PW…` 같은 글자가 종이에 찍힘 | 프린터가 ZPL 이 아니다 → 2번 |
| 반쯤만 나오고 잘림 | 용지 길이 감지 — 캘리브레이션 다시 |

## 4. 확인한다

형마다 `.zpl` 을 한 장씩 찍어 라벨지 선인쇄 칸과 대본다.

- [ ] **어느 형의 칸에 글자가 맞아 들어가는가** — 이게 우리 라벨지의 형이다
- [ ] NL: 글자가 옆으로 누워 나오면 롤이 102mm 폭으로 감긴 것 → NL 을 90° 돌려야 한다(core `rotation`)
- [ ] NL: 라벨 실측 세로 길이 — 102mm 로 가정했다
- [ ] ITF(운송장번호)·CODE128(도착지 터미널) 이 스캐너로 읽힌다
- [ ] 한글이 판독된다 · 출고번호(작은 글자)가 읽힌다
- [ ] 배달표 받는분 주소가 동·호수까지 찍힌다
- [ ] `*.compressed.zpl` 도 같은 결과다(같으면 core 압축 기본값을 켠다)
- [ ] 칸이 전체적으로 한쪽으로 밀리면 먼저 프린터 자체 오프셋으로 맞춘다
- [ ] NL: ITF 가 라벨 오른쪽 끝에 가깝다(여백 3.88mm, 요구 3.75mm) — NL 의 ITF 를 따로 스캔해 본다
- [ ] NS: 선인쇄와 위아래가 뒤집혀 나오면 NS 템플릿의 `rotation` 을 90 → 270 으로 바꾼다(FS 는 이 이유로 270 이다)
- [ ] FS 품목 7줄 견본: 두 쪽 모두 품목이 같은 칸에 찍히고, 2쪽의 「발송 금지」 두 곳과 쪽 표시(`2/2 · 총 7건 13개`)가 선인쇄를 밟지 않는다

## 5. 결과를 남긴다

#913 에 코멘트: 라벨지 형, 사진(개인정보 없음 — 합성 데이터), 위 체크리스트 결과.
형이 NS 가 아니면 운영 Core 에 `HANJIN_LABEL_TYPE=NL`(또는 `FS`)을 넣어야 한다 — `HANJIN_*` env 배선과
함께 배포한다.

## 6. 로케이션·SKU 라벨(#1281)

같은 TX400 계열 라벨 프린터로 로케이션 라벨(50×30)과 SKU 라벨(30×10·50×30)을 뽑는다. 송장 절과 무관하다.

- 스테이션 설정의 **«라벨 프린터» 칸은 «송장 프린터» 칸과 따로**다(저장 키도 별개). 송장은 Xprinter, 라벨은 TX400 처럼
  두 대를 같은 PC 에 두고 각각 지정한다. 한쪽을 바꿔도 다른 쪽 출력은 그대로여야 한다.
- **롤을 바꾸면 갭 센서를 보정한다.** 롤을 넣고 프린터를 켠 채 보정(캘리브레이션) 버튼을 눌러 갭 길이를 다시 읽힌다.
  보정 없이 크기가 다른 롤(30×10 ↔ 50×30)을 넣으면 라벨 사이에서 밀리거나 한 장씩 건너뛴다.
- **ZPL 을 파일로 받아 확인한다.** 라벨 엔드포인트는 `inventory.stock.read` 권한이 필요하고 응답 `data` 가 ZPL 이다.
  `skipped` 에 못 그린 항목과 사유가 온다. 그릴 것이 없으면 `data` 는 빈 문자열이다.

  ```bash
  # 로케이션: rackId 또는 locationIds(둘 중 하나)
  curl -sS -X POST "$CORE/inventory/labels/locations" -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' -d '{"locationIds":["<location-uuid>"]}' \
    | jq -r .data > location-label.zpl

  # SKU: size 는 30x10 또는 50x30, copies 1~200
  curl -sS -X POST "$CORE/inventory/labels/skus" -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' -d '{"size":"30x10","items":[{"skuId":"<sku-uuid>","copies":1}]}' \
    | jq -r .data > sku-label.zpl
  ```

  보내는 법은 3절과 같다(`copy /b location-label.zpl \\localhost\<라벨 프린터 공유 이름>`).
- 역렌더로 미리 볼 때는 `zpl-renderer-js` 의 `zplToBase64Async(zpl, 폭mm, 높이mm, 8)`, 디코드는 `zxing-cpp` 를 쓴다.
  ⚠️ 이 역렌더러는 invocation code 를 제대로 처리하지 못한다 — `>5`(Code C 전환)를 읽으면 글자가 깨지거나 디코드가 안 되고,
  `>6` 뒤에 한 글자만 남으면 그 글자를 그리지 않는다. 11자리 SKU(`>:1>51198120000`)는 그래서 이 역렌더로 디코드되지 않는다.
  심볼 값을 직접 쌓아 그린 Code128(`python-barcode` 표 + `zxing-cpp`)로는 정확히 디코드되므로 ZPL 문자열은 맞고,
  실물 판정은 프린터 출력과 스캐너로 한다.
- 30×10 에 11자리 SKU 를 찍으면 바코드 폭이 약 28 mm 여야 한다. 글자 `>;` 가 찍히거나 폭이 39 mm 쯤이면 프린터가
  invocation code 를 못 먹는 것이다.
- **첫 실물 확인.** 같은 값(`11198120000`)을 인코딩 변형별로 한 장씩 찍는 ZPL(A 우리 인코딩 `>:1>5…`, B `>;…>60`, C 모드 A 자동, D 순수 B)을 만들어 프린터로 보낸다.
  변형마다 스캐너로 읽어 값이 `11198120000` 인지, 폭이 약 28 mm(D 만 약 39 mm)인지 본다.
  A 가 안 읽히는데 C 가 읽히면 `barcodeField` 를 CODE128_OPTIMAL 에서 모드 A(`^BCN,…,N,N,N,A`)로 바꾼다.
