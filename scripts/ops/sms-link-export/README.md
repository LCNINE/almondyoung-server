# sms-link-export — 외부 발송용 수신자별 추적 링크 만들기

외부 문자 서비스에 엑셀로 올려 보낼 문자를 만든다. 수신자마다 다른 `/r/<코드>` 링크를 넣고, 그 링크 행을
notification DB(`external_sms_campaigns`·`sms_tracked_links`)에 넣는다. 링크를 누른 브라우저가 쇼핑몰에서
로그인·가입하거나 이미 로그인해 있으면 `sms_link_attributions` 에 계정이 남는다.

## 입력

| 인자 | 뜻 |
|---|---|
| `--list=<파일>` | 번호 목록. `.xlsx`(첫 시트 A열) 또는 한 줄에 하나인 텍스트/CSV. 숫자가 없는 1행은 머리글로 건너뛴다 |
| `--template=<파일>` | 문구. `{{이름}}` 은 회원 이름(모르면 대체 이름)으로, 본문 안의 URL 은 수신자별 추적 링크로 바뀐다. URL 이 없으면 멈춘다. `(광고)`·수신거부 문구는 넣지 않는다(발송 서비스가 붙인다) |
| `--campaign=<이름>` | 캠페인 이름. 같은 이름은 두 번 넣지 않는다 |
| `--provider=<이름>` | 보낼 발송 서비스. `external_sms_campaigns.provider` 에 그대로 남는다(코드에 기본값 없음) |
| `--tenant=<id>` | 회원을 찾을 테넌트(`users.tenant_id` 값, slug 아님). 기본값 없음. 그 테넌트에 번호 있는 계정이 하나도 없으면 멈춘다 |
| `--created-by=<id>` | 만든 사람 |
| `--out=<파일.xlsx>` | 업로드 엑셀. 레포 밖이나 git 이 무시하는 경로만 받는다 |
| `--apply` | 없으면 dry-run |

| 환경변수 | 뜻 |
|---|---|
| `USER_DATABASE_URL` | user-service DB (회원·번호·마케팅 동의) |
| `NOTIFICATION_DATABASE_URL` | notification DB (수신거부 읽기, 링크 쓰기) |
| `STOREFRONT_URL` | 쇼핑몰 주소. 링크는 `<STOREFRONT_URL>/r/<코드>` |

## 판정

형식 오류·명단 안 중복·수신거부(`sms_opt_outs`)는 뺀다. 번호의 계정이 휴면·탈퇴뿐이면 뺀다(비회원으로 보내지 않는다). 번호의 회원이 한 명이면 그 회원이 마케팅에 동의했을 때만
보내고 링크에 회원 id 를 적는다. 한 번호에 회원이 여럿이면 한 명이라도 동의했을 때 보내고 회원 id 는 비운다.
회원이 아닌 번호는 보낸다.

길이는 발송 서비스 셈(ASCII 1·그 밖 2바이트)에 고정 문구 33바이트를 더한다. 90바이트 넘으면 LMS, 2000바이트 넘는 행이 있으면 멈춘다.

## 순서

1. 터널은 사람이 띄운다.
2. dry-run 으로 갈래별 수·SMS/LMS 수·예시(번호 가림)를 본다.
3. `--apply` — 엑셀을 임시 파일로 쓴 뒤 한 트랜잭션으로 캠페인·링크를 넣고, 커밋이 성공해야 엑셀이 제 이름이 된다.
4. 엑셀을 발송 서비스에 올린 뒤 지운다.

```bash
USER_DATABASE_URL=… NOTIFICATION_DATABASE_URL=… STOREFRONT_URL=https://shop.example \
  npx tsx scripts/ops/sms-link-export/index.ts --list=list.csv --template=message.txt \
  --campaign=acme-2026-01 --provider=<발송 서비스> --tenant=<테넌트 id(users.tenant_id 값)> --created-by=<직원 id> --out=<레포 밖 또는 .scratch>/acme-2026-01.xlsx
```
