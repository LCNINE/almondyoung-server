# 시간대/날짜 유틸 가이드 (Asia/Seoul)

본 문서는 WMS 내에서 한국 표준시(Asia/Seoul, GMT+9)를 일관되게 다루기 위한 유틸 사용 가이드를 설명합니다.

## 배경

- 도메인 정책상 “당일” 판정, 운영 리포트 경계 등은 Asia/Seoul 기준으로 처리해야 합니다.
- 서버 시스템 시간이 UTC일 수 있으므로, 모든 “당일 비교/표시” 로직에서 한국 시간대 변환이 필요합니다.

## 사용 라이브러리

- `date-fns`, `date-fns-tz`
- 설치는 `package.json`에 반영되어 있습니다.

## 제공 유틸

소스: `apps/wms/src/shared/services/time.util.ts`

```ts
import { utcToZonedTime } from 'date-fns-tz';
import { isSameDay } from 'date-fns';

const SEOUL_TZ = 'Asia/Seoul';

export function toSeoulTime(date: Date | string | number): Date {
  const d = date instanceof Date ? date : new Date(date);
  return utcToZonedTime(d, SEOUL_TZ);
}

export function isSameSeoulDay(a: Date | string | number, b: Date | string | number): boolean {
  const az = toSeoulTime(a);
  const bz = toSeoulTime(b);
  return isSameDay(az, bz);
}

export function nowSeoul(): Date {
  return toSeoulTime(new Date());
}
```

## 사용 예시

- 당일 제한 검증(입고취소 등)

```ts
import { isSameSeoulDay, nowSeoul } from '../../shared/services/time.util';

const canCancelToday = isSameSeoulDay(nowSeoul(), receipt.occurredAt);
if (!canCancelToday) throw new BadRequestException('cancel is allowed only on the same day (Asia/Seoul)');
```

- 화면 표시 전에 KST로 변환

```ts
const occurredAtKst = toSeoulTime(receipt.occurredAt);
```

## 권장 사항

- “오늘/어제/당일” 등 날짜 비교는 반드시 `isSameSeoulDay`를 사용하십시오.
- 서비스/컨트롤러에서는 직접 `date-fns-tz`를 import하지 말고 유틸을 통해 접근하십시오(일관성 유지).
- 이벤트 타임스탬프를 기록할 때는 UTC 기준 `Date`를 그대로 저장하고, 비교/표시에서만 KST로 변환하십시오.
