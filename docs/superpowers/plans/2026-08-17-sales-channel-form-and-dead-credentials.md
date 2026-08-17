# 판매채널 폼 정합성 + 죽은 credentials 제거 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/account/sales-channel` 화면에서 `site='naver'` 판매채널을 만들 수 있게 하고, 그 과정에서 열리는 "효과 없는 시크릿 입력" 경로를 먼저 걷어낸다.

**Architecture:** 두 PR 로 나눈다. **PR 1(#650)이 반드시 먼저다** — PR 2 가 생성 폼을 고치는 순간, 지금 400 이 우연히 막고 있던 평문 시크릿 저장 경로가 열리기 때문이다. PR 1 은 API 표면과 화면에서 `credentials`·API 키 입력을 제거한다(컬럼 `DROP` 은 이 계획 밖 — expand-contract 별도 2 PR). PR 2 는 `sales_channels` 의 두 축(`type` = 채널 형태, `site` = 채널 정체)을 화면에서 분리하고, 드롭다운 어휘의 정본을 프런트 하드코딩 상수에서 서버 어휘 `SALES_CHANNELS` 로 옮긴다.

**Tech Stack:** NestJS + Drizzle (apps/core), Next.js 15 + TanStack Query + shadcn/ui (apps/admin-web), class-validator, Jest

**Spec:**
- #650 `sales_channels.credentials / config 는 죽은 컬럼인데 시크릿을 유도한다`
- #649 `판매채널 관리 화면이 백엔드 모델과 어긋난다 — type/site 혼동 + is_active 무배선` — **결함 1 만**
- ADR-0031 결정 7 (`docs/adr/0031-channel-capability-vector-and-listing-ownership.md`)

## Global Constraints

- **PR 1 → 배포 → PR 2** 순서. 두 PR 을 한 배포에 묶지 말 것. PR 2 만 먼저 가면 시크릿 저장 경로가 열린다.
- **마이그레이션 0건.** 두 PR 모두 스키마를 건드리지 않는다. `credentials` / `config` 컬럼은 남는다 — `DROP COLUMN` 은 destructive 라 ADR-0005 §5 의 별도 2 PR 이고 이 계획 밖이다.
- **`site` 어휘 정본은 `SALES_CHANNELS = ['medusa', 'naver', 'coupang', '3pl']`** (`packages/event-contracts/streams/orders.stream.ts:53`). 프런트에 이 목록을 손으로 복사한 두 번째 정본을 만들지 말 것 — Task 5 의 드리프트 가드 스펙이 이를 강제한다.
- **`type` 어휘는 `['ONLINE', 'OFFLINE', 'MARKETPLACE', 'MOBILE_APP', 'SOCIAL_COMMERCE']`** (`create-sales-channel.dto.ts:13`). 이건 DB enum 이 아니라 DTO 의 `@IsEnum` 배열이다.
- **전역 ValidationPipe 는 `whitelist: true, forbidNonWhitelisted: false`** (`apps/core/src/platform/http/validation-pipe.ts:12-17`). 즉 DTO 에서 필드를 지우면 그 필드는 **400 이 아니라 조용히 제거**된다. 옛 클라이언트가 `credentials` 를 계속 보내도 깨지지 않는다.
- **admin-web 은 컴포넌트 테스트가 불가능하다** (렌더러 없음 + `.tsx` 가 transform 밖). 판정 가능한 로직은 반드시 `.ts` 순수 모듈로 뽑아야 검증된다. **테스트 초록 ≠ 화면 동작** — 마지막 브라우저 스모크가 유일한 배선 판정이다.
- 검증 게이트: `npm run type-check` → 0, `npx jest --maxWorkers=2` → 실패 0, `npm run test:admin-web` → 실패 0.

## 이 계획이 다루지 않는 것

- **#649 결함 2 (`is_active` 집행 지점)** — 별도 계획. 수집 경로(orchestrator)에만 집행하고 리스팅 조회에는 넣지 않는 것이 권고(리스팅 조회를 막으면 비활성 채널의 기존 주문이 식별 실패로 격리되어 #647 과 같은 함정이 된다).
- **`credentials` / `config` 컬럼 `DROP`** — expand-contract 별도 2 PR.
- **`SalesChannelMark` 의 아이콘 자산 문제** — 아래 "조사 중 발견한 것" 참조. 이 계획은 판매채널 표에서만 텍스트 라벨로 우회한다.

## 조사 중 발견한 것 (이슈 본문에 없던 사실)

실행자가 놀라지 않도록 먼저 적는다. 전부 2026-08-17 확인.

1. **시크릿 입력면이 하나가 아니라 둘이다.** #650 은 `form-dialog/index.tsx:190-210` 만 지목했지만, 표의 "API 인증키 수정" 버튼이 여는 **`api-key-dialog/index.tsx` 가 두 번째 입력면**이다. 이쪽도 `config` 에 `accessKey`/`secretKey`/`apiKey` 를 쓴다. PR 1 이 둘 다 걷어내야 한다.
2. **표가 `config.loginId` 와 `config.password` 를 컬럼으로 노출한다** (`use-sales-channel-table-columns.tsx:33-50`). password 는 마스킹되지만 loginId 는 평문이다. 이것도 PR 1 범위다.
3. **목록 필터도 같은 혼동으로 깨져 있다.** 필터 드롭다운이 `SALES_CHANNEL_SITES` 로 채워지고 그 값을 `type` 쿼리로 보낸다(`use-sales-channel-table-query.ts:11`, `sales-channels.service.ts:113` `eq(salesChannels.type, filters.type)`). 즉 **"네이버 스마트스토어" 로 거르면 항상 0행**이다. PR 2 가 `site` 필터를 서버에 추가해 함께 고친다.
4. **표의 "채널 타입" 컬럼은 세 번째 어휘를 쓴다.** `SalesChannelMark` 의 타입은 `'almondyoung' | 'coupang' | 'naver_smartstore' | 'phone_order' | 'other'` (`sales-channel-mark.tsx:9`) 로 `type` 도 `site` 도 아니다. 거기에 `channel.type`(`'ONLINE'`)이 들어가므로 `channelConfig['ONLINE']` 이 `undefined` → **빨간 "Unknown" 이 렌더된다**.
5. **그 아이콘 자산이 저장소에 없다.** `apps/admin-web/public/` 디렉터리가 워킹트리에 존재하지 않고 `git ls-files` 에 `*_mark.png` 가 0건이다. 즉 `/icons/almondyoung_mark.png` 등은 저장소가 제공하지 않는다. 판매채널 표는 텍스트 라벨로 바꾸고, **다른 화면의 `SalesChannelMark` 사용처(주문 매칭 표·지역별 송장 표)는 건드리지 않는다** — 별도 이슈감이다.
6. **`CreateSalesChannelDto.type` 은 이미 `@IsOptional()`** 이다(`create-sales-channel.dto.ts:12`). 하지만 `@IsOptional` 은 `null`/`undefined` 만 건너뛰므로, 폼이 보내는 `''` 이나 `'naver_smartstore'` 는 그대로 `@IsEnum` 에 걸린다. 이슈의 "항상 400" 진단은 맞다.

---

# PR 1 — #650: 죽은 시크릿 입력면 제거

## File Structure (PR 1)

| 파일 | 책임 변화 |
|---|---|
| `apps/core/.../dto/sales-channels/create-sales-channel.dto.ts` | `credentials` 필드 제거 |
| `apps/core/.../dto/sales-channels/update-sales-channel.dto.ts` | `credentials` 필드 제거 |
| `apps/core/.../dto/sales-channels/sales-channel-response.dto.ts` | `credentials` 응답 필드 제거 |
| `apps/core/.../mappers/sales-channel.mapper.ts` | `credentials` 매핑 제거 |
| `apps/core/.../mappers/sales-channel.mapper.spec.ts` | **신설** — 응답에 시크릿이 안 실리는 것을 못 박음 |
| `apps/core/.../sales-channels.service.ts` | insert 에서 `credentials` 제거, `validateChannelConfig` 의 시크릿 검사 제거 |
| `apps/core/.../sales-channels.validate-config.spec.ts` | 시크릿 검사 기대를 뒤집음 |
| `apps/admin-web/.../features/sales-channel/components/api-key-dialog/index.tsx` | **삭제** |
| `apps/admin-web/.../hooks/table/columns/use-sales-channel-table-columns.tsx` | loginId·password·API키 컬럼 제거 |
| `apps/admin-web/.../features/sales-channel/components/table/index.tsx` | `ApiKeyDialog` 배선 제거 |
| `apps/admin-web/.../features/sales-channel/components/form-dialog/index.tsx` | "로그인 정보"·"API 키 정보" 섹션 제거 |

---

### Task 1: core — 응답에서 `credentials` 를 지운다

가장 위험한 표면부터 닫는다. 지금은 판매채널 조회 권한만 있으면 `credentials` 를 읽는다.

**Files:**
- Create: `apps/core/src/modules/catalog/core/channels/mappers/sales-channel.mapper.spec.ts`
- Modify: `apps/core/src/modules/catalog/core/channels/dto/sales-channels/sales-channel-response.dto.ts:59-60`
- Modify: `apps/core/src/modules/catalog/core/channels/mappers/sales-channel.mapper.ts:31`

**Interfaces:**
- Consumes: `SalesChannelWithCategory` (`mappers/sales-channel.mapper.ts:11-13`), `SalesChannelDto`
- Produces: `SalesChannelDto` **without** a `credentials` property. Task 3·4 의 admin-web 변경이 이 축소된 응답을 전제로 한다.

- [ ] **Step 1: 실패하는 스펙을 쓴다**

`apps/core/src/modules/catalog/core/channels/mappers/sales-channel.mapper.spec.ts`:

```typescript
import { SalesChannelMapper, SalesChannelWithCategory } from './sales-channel.mapper';

/**
 * `sales_channels.credentials` 는 런타임 소비자가 0곳인 죽은 컬럼인데, 어드민 응답에는
 * 그대로 실려 나갔다 (#650). 채널 인증의 정본은 SST Secret / env 다.
 * 이 스펙이 "응답에 시크릿 자리를 만들지 않는다"를 못 박는다.
 */
describe('SalesChannelMapper', () => {
  function entity(overrides: Partial<SalesChannelWithCategory> = {}): SalesChannelWithCategory {
    return {
      id: '019d0003-0001-7000-a000-000000000001',
      type: 'ONLINE',
      site: 'medusa',
      categoryId: null,
      category: null,
      name: '아몬드영 자사몰',
      description: null,
      config: null,
      isActive: true,
      apiEndpoint: null,
      // DB 에 남아 있는 컬럼이라 엔티티에는 여전히 존재한다 — 응답으로 새지 않는지가 관심사다
      credentials: { clientSecret: 'must-not-leak' },
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-17T00:00:00.000Z'),
      ...overrides,
    } as SalesChannelWithCategory;
  }

  it('응답에 credentials 를 싣지 않는다', () => {
    const dto = SalesChannelMapper.toDto(entity());

    expect(dto).not.toHaveProperty('credentials');
    expect(JSON.stringify(dto)).not.toContain('must-not-leak');
  });

  it('나머지 필드는 그대로 매핑한다', () => {
    const dto = SalesChannelMapper.toDto(entity());

    expect(dto.id).toBe('019d0003-0001-7000-a000-000000000001');
    expect(dto.site).toBe('medusa');
    expect(dto.type).toBe('ONLINE');
    expect(dto.isActive).toBe(true);
    expect(dto.config).toEqual({});
    expect(dto.createdAt).toBe('2026-08-17T00:00:00.000Z');
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/catalog/core/channels/mappers/sales-channel.mapper.spec.ts --maxWorkers=2`
Expected: FAIL — `expect(received).not.toHaveProperty("credentials")` (매퍼가 아직 싣는다)

- [ ] **Step 3: 응답 DTO 에서 필드를 제거한다**

`sales-channel-response.dto.ts` 에서 이 두 줄을 지운다:

```typescript
  @ApiProperty({ description: '인증 정보' })
  credentials: Record<string, any>;
```

- [ ] **Step 4: 매퍼에서 매핑을 제거한다**

`sales-channel.mapper.ts:31` 의 이 줄을 지운다:

```typescript
      credentials: entity.credentials ?? {},
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx jest apps/core/src/modules/catalog/core/channels/mappers/sales-channel.mapper.spec.ts --maxWorkers=2`
Expected: PASS (2 tests)

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/catalog/core/channels/dto/sales-channels/sales-channel-response.dto.ts \
        apps/core/src/modules/catalog/core/channels/mappers/sales-channel.mapper.ts \
        apps/core/src/modules/catalog/core/channels/mappers/sales-channel.mapper.spec.ts
git commit -m "fix(catalog): 판매채널 응답에서 죽은 credentials 를 제거한다 (#650)"
```

---

### Task 2: core — 쓰기 경로와 config 검사에서 시크릿을 걷어낸다

읽기를 막았으니 이제 쓰기를 막는다. `validateChannelConfig` 의 naver/coupang 분기는 "여기에 키를 넣는 게 맞다"는 신호를 주는 마지막 코드다.

**Files:**
- Modify: `apps/core/src/modules/catalog/core/channels/dto/sales-channels/create-sales-channel.dto.ts:57-59`
- Modify: `apps/core/src/modules/catalog/core/channels/dto/sales-channels/update-sales-channel.dto.ts:60-62`
- Modify: `apps/core/src/modules/catalog/core/channels/sales-channels.service.ts:43,315-325`
- Test: `apps/core/src/modules/catalog/core/channels/sales-channels.validate-config.spec.ts:33-38`

**Interfaces:**
- Consumes: `SALES_CHANNELS` from `@packages/event-contracts/streams`
- Produces: `CreateSalesChannelDto` / `UpdateSalesChannelDto` **without** `credentials`. `validateChannelConfig(site, config)` 는 어휘 검사와 medusa `baseUrl` 검사만 남는다.

- [ ] **Step 1: 기존 스펙의 기대를 뒤집는다 (실패하는 상태로)**

`sales-channels.validate-config.spec.ts` 의 마지막 테스트(33-38행)를 아래로 **교체**한다:

```typescript
  // #650: 채널 인증의 정본은 SST Secret / env 다. `config` 에 키를 넣어도 아무도 안 읽으므로
  // "넣으라"는 신호를 주는 검사 자체를 걷어냈다. 검사가 되살아나면 이 스펙이 잡는다.
  it.each(['naver', 'coupang'])('%s 의 config 에서 인증 키를 요구하지 않는다', async (site) => {
    const result = await service.validateChannelConfig(site, {});

    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/catalog/core/channels/sales-channels.validate-config.spec.ts --maxWorkers=2`
Expected: FAIL — `naver` 케이스가 `clientId and clientSecret` 오류를 반환한다

(주의: `coupang` 케이스는 `config` 가 `{}` 라 truthy 이므로 역시 실패한다. 둘 다 빨간 게 정상이다.)

- [ ] **Step 3: 서비스의 시크릿 검사를 제거한다**

`sales-channels.service.ts` 의 `switch (site)` (308-332행)에서 `coupang` 과 `naver` 케이스를 통째로 지운다. 결과는 이렇게 된다:

```typescript
    switch (site) {
      case 'medusa':
        if (config && !config.baseUrl) {
          errors.push('Medusa channel requires baseUrl in config');
        }
        break;

      default:
        // 어휘 정본은 `SALES_CHANNELS` 하나다 (ADR-0031 결정 7) — DTO 와 같은 배열을 본다.
        if (!(SALES_CHANNELS as readonly string[]).includes(site)) {
          errors.push(`Unsupported channel type: ${site}. Supported types are: ${SALES_CHANNELS.join(', ')}`);
        }
    }
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/core/src/modules/catalog/core/channels/sales-channels.validate-config.spec.ts --maxWorkers=2`
Expected: PASS

- [ ] **Step 5: 입력 DTO 두 곳에서 `credentials` 를 제거한다**

`create-sales-channel.dto.ts` 와 `update-sales-channel.dto.ts` 에서 각각 이 세 줄을 지운다:

```typescript
  @ApiProperty({ description: '인증 정보', required: false })
  @IsOptional()
  credentials?: Record<string, any>;
```

`whitelist: true` 라 옛 클라이언트가 계속 보내도 400 이 아니라 조용히 제거된다 (Global Constraints 참조).

- [ ] **Step 6: 서비스의 insert 에서 `credentials` 를 제거한다**

`sales-channels.service.ts:43` 의 이 줄을 지운다:

```typescript
        credentials: data.credentials || null,
```

`updateChannel` 은 `{ ...data }` 스프레드라 별도 수정이 필요 없다 — DTO 에서 사라졌으므로 더 이상 흘러들지 않는다.

- [ ] **Step 7: 타입 체크와 전체 스펙을 돌린다**

Run: `npm run type-check`
Expected: 에러 0

Run: `npx jest apps/core/src/modules/catalog/core/channels --maxWorkers=2`
Expected: 실패 0

`NewSalesChannel` / `UpdateSalesChannel`(`catalog.types.ts`)이 `credentials` 를 여전히 들고 있어도 무방하다 — 그건 DB 행 타입이고 컬럼은 남아 있다. 타입 에러가 나면 그건 다른 곳이 `dto.credentials` 를 읽고 있다는 뜻이니, 그 사용처를 찾아 함께 지운다.

- [ ] **Step 8: 커밋**

```bash
git add apps/core/src/modules/catalog/core/channels/dto/sales-channels/create-sales-channel.dto.ts \
        apps/core/src/modules/catalog/core/channels/dto/sales-channels/update-sales-channel.dto.ts \
        apps/core/src/modules/catalog/core/channels/sales-channels.service.ts \
        apps/core/src/modules/catalog/core/channels/sales-channels.validate-config.spec.ts
git commit -m "fix(catalog): 판매채널 쓰기 경로와 config 검사에서 시크릿을 걷어낸다 (#650)"
```

---

### Task 3: admin-web — API 키 다이얼로그와 크레덴셜 컬럼을 삭제한다

**Files:**
- Delete: `apps/admin-web/src/features/sales-channel/components/api-key-dialog/index.tsx`
- Modify: `apps/admin-web/src/hooks/table/columns/use-sales-channel-table-columns.tsx:33-64`
- Modify: `apps/admin-web/src/features/sales-channel/components/table/index.tsx:17,26,81,117-122`

**Interfaces:**
- Produces: `useSalesChannelTableColumns({ onEdit, onDelete })` — `onApiKeyEdit` prop 이 사라진다. Task 9 가 이 시그니처 위에 site 컬럼을 얹는다.

- [ ] **Step 1: 다이얼로그 파일을 지운다**

```bash
git rm apps/admin-web/src/features/sales-channel/components/api-key-dialog/index.tsx
```

- [ ] **Step 2: 표에서 배선을 제거한다**

`components/table/index.tsx` 에서 네 곳을 지운다:

1. `import { ApiKeyDialog } from '../api-key-dialog';` (17행)
2. `const [apiKeyTarget, setApiKeyTarget] = useState<ChannelDto | null>(null);` (26행)
3. `useSalesChannelTableColumns` 호출의 `onApiKeyEdit: setApiKeyTarget,` (81행)
4. `<ApiKeyDialog ... />` 블록 전체 (117-122행)

`useState` import 가 다른 곳에서 안 쓰이면 3행의 import 도 정리한다.

- [ ] **Step 3: 컬럼에서 크레덴셜 3개를 지운다**

`use-sales-channel-table-columns.tsx` 에서 `loginId`·`password`·`apiKey` display 컬럼(33-64행)을 통째로 지우고, props 타입과 구조분해에서 `onApiKeyEdit` 를 제거한다. `Button` import 는 `actions` 컬럼이 계속 쓰므로 남긴다.

결과 컬럼 구성: `type`(마크) · `name` · `actions`.

- [ ] **Step 4: 타입 체크**

Run: `npm run type-check`
Expected: 에러 0

- [ ] **Step 5: 커밋**

```bash
git add -A apps/admin-web/src/features/sales-channel apps/admin-web/src/hooks/table/columns/use-sales-channel-table-columns.tsx
git commit -m "fix(admin-web): 판매채널 표에서 API 키 다이얼로그와 크레덴셜 컬럼을 걷어낸다 (#650)"
```

---

### Task 4: admin-web — 등록/수정 폼에서 시크릿 입력을 제거한다

**Files:**
- Modify: `apps/admin-web/src/features/sales-channel/components/form-dialog/index.tsx`

**Interfaces:**
- Produces: `formData` 에서 `loginId`·`password`·`hasOtp`·`apiKey`·`accessKey`·`secretKey` 가 사라진 폼. Task 8 이 이 축소된 폼 위에 site/type 두 축을 얹는다.

**판단 메모:** `loginId` 는 시크릿이 아니지만 `password` 바로 옆에 있어 "여기에 계정을 넣으라"는 신호의 일부다. 메모가 필요하면 이미 있는 `memo` 필드가 그 자리를 대신한다. 전부 제거를 권고하며, 운영자가 shop ID 표시를 원하면 그건 별도 요청으로 받는다.

- [ ] **Step 1: 상태에서 시크릿 필드를 지운다**

`useState` 초기값(52-75행)과 `resetForm`(94-112행) 양쪽에서 아래 6개를 제거한다. **두 곳 모두 고쳐야 한다** — 하나만 고치면 타입이 갈린다.

```typescript
    loginId: '',
    password: '',
    hasOtp: false,
    apiKey: '',
    accessKey: '',
    secretKey: '',
```

- [ ] **Step 2: 편집 모드 매핑에서 지운다**

`useEffect`(116-148행)의 `setFormData` 에서 `loginId`·`password`·`hasOtp`·`apiKey`·`accessKey`·`secretKey` 여섯 줄을 제거한다.

- [ ] **Step 3: 제출 payload 에서 지운다**

`handleSubmit` 에서 `keyPayload` 블록(190-197행)을 통째로 지우고, `apiConfig` 를 아래로 줄인다:

```typescript
    const apiConfig = {
      memo: formData.memo || undefined,
      feeRate: formData.feeRate ? Number(formData.feeRate) : undefined,
      smartstoreUrl: isSmartstore ? formData.smartstoreUrl || undefined : undefined,
      companyCode: isCoupang ? formData.companyCode || undefined : undefined,
      shipper,
    };
```

- [ ] **Step 4: JSX 에서 두 섹션을 지운다**

"로그인 정보" 섹션(324-370행)과 "API 키 정보" 섹션(372-429행)을 통째로 삭제한다. `Switch` import 는 "활성화" 토글이 계속 쓰므로 남긴다.

- [ ] **Step 5: 타입 체크와 admin-web 스펙**

Run: `npm run type-check`
Expected: 에러 0

Run: `npm run test:admin-web`
Expected: 실패 0

- [ ] **Step 6: 커밋**

```bash
git add apps/admin-web/src/features/sales-channel/components/form-dialog/index.tsx
git commit -m "fix(admin-web): 판매채널 폼에서 효과 없는 시크릿 입력란을 제거한다 (#650)"
```

---

### PR 1 마무리

- [ ] **전체 게이트**

```bash
npm run type-check
npx jest --maxWorkers=2
npm run test:admin-web
```
Expected: 셋 다 실패 0

- [ ] **배포 전 라이브 재확인** — #650 이 요구하는 선행이다. 값이 들어간 뒤라면 성격이 달라진다(그땐 회전이 먼저).

```sql
SELECT id, site, credentials IS NOT NULL AS has_credentials, config IS NOT NULL AS has_config
FROM sales_channels;
```
기대: `has_credentials` 전부 false. 아니면 **중단하고 보고**한다.

- [ ] **PR 생성** — 제목 `fix(catalog,admin-web): 죽은 credentials 시크릿 입력면을 걷어낸다 (#650)`. 본문에 "마이그레이션 0건 / 컬럼 DROP 은 별도 2 PR / #649 보다 먼저 배포되어야 하는 이유" 를 적는다.

---

# PR 2 — #649 결함 1: 폼의 type/site 분리

**PR 1 이 배포 완료된 뒤에 시작한다.**

## File Structure (PR 2)

| 파일 | 책임 |
|---|---|
| `apps/admin-web/src/lib/api/domains/sales-channel/vocabulary.ts` | **신설** — site·type 어휘와 표시 라벨. 순수 `.ts` (테스트 가능) |
| `apps/admin-web/src/lib/api/domains/sales-channel/vocabulary.spec.ts` | **신설** — 서버 어휘 `SALES_CHANNELS` 와의 드리프트 가드 |
| `apps/admin-web/src/features/sales-channel/form-payload.ts` | **신설** — 폼 상태 → 요청 payload 변환. 순수 `.ts` (테스트 가능) |
| `apps/admin-web/src/features/sales-channel/form-payload.spec.ts` | **신설** — site 가 실제로 실리는지 못 박음 |
| `apps/admin-web/src/lib/types/dto/products.ts` | `site` 필드 추가 |
| `apps/admin-web/.../form-dialog/index.tsx` | 드롭다운 2축 분리, payload 빌더 사용 |
| `apps/admin-web/.../filter-box/index.tsx` | `type` 필터 → `site` 필터 |
| `apps/admin-web/src/hooks/table/query/use-sales-channel-table-query.ts` | 쿼리 파라미터 `type` → `site` |
| `apps/admin-web/.../use-sales-channel-table-columns.tsx` | site 컬럼(텍스트) + type 컬럼 |
| `apps/admin-web/.../sales-channel/queries.ts` | 죽은 `SALES_CHANNEL_SITES` / `useSalesChannelSites` 제거 |
| `apps/core/.../sales-channels.controller.ts` | 목록 쿼리에 `site` 추가 |
| `apps/core/.../sales-channels.service.ts` | `getChannels` 필터에 `site` 추가 |
| `apps/core/.../sales-channels.filter.spec.ts` | **신설** — site 필터 |

---

### Task 5: admin-web — 어휘 모듈과 드리프트 가드

이 계획의 핵심 방어선이다. 프런트 하드코딩 상수가 서버 어휘와 갈려도 아무도 모르던 상태를 여기서 끝낸다.

**Files:**
- Create: `apps/admin-web/src/lib/api/domains/sales-channel/vocabulary.ts`
- Create: `apps/admin-web/src/lib/api/domains/sales-channel/vocabulary.spec.ts`

**Interfaces:**
- Consumes: `SALES_CHANNELS` from `@packages/event-contracts/streams/orders.stream` (스펙에서만 import — 컴포넌트 번들에는 안 들어간다)
- Produces:
  - `type SalesChannelSite = 'medusa' | 'naver' | 'coupang' | '3pl'`
  - `SALES_CHANNEL_SITE_LABELS: Record<SalesChannelSite, string>`
  - `SALES_CHANNEL_SITE_OPTIONS: ReadonlyArray<{ value: SalesChannelSite; label: string }>`
  - `type ChannelFormType = 'ONLINE' | 'OFFLINE' | 'MARKETPLACE' | 'MOBILE_APP' | 'SOCIAL_COMMERCE'`
  - `CHANNEL_TYPE_OPTIONS: ReadonlyArray<{ value: ChannelFormType; label: string }>`
  - `siteLabel(site: string): string`

Task 8·9·10 이 전부 이 모듈을 소비한다.

- [ ] **Step 1: 실패하는 드리프트 가드 스펙을 쓴다**

`vocabulary.spec.ts`:

```typescript
import { SALES_CHANNELS } from '@packages/event-contracts/streams/orders.stream';
import {
  SALES_CHANNEL_SITE_LABELS,
  SALES_CHANNEL_SITE_OPTIONS,
  CHANNEL_TYPE_OPTIONS,
  siteLabel,
} from './vocabulary';

/**
 * 판매채널 드롭다운의 값은 `sales_channels.site` 로 그대로 전송된다. 그 어휘의 정본은
 * 서버의 `SALES_CHANNELS` 하나다 (ADR-0031 결정 7).
 *
 * 예전에는 프런트가 `naver_smartstore` / `phone_order` / `other` 라는 별도 목록을 들고 있었고,
 * 서버가 어휘를 좁혔을 때 아무도 눈치채지 못했다 (#649 결함 1). 이 스펙이 그 드리프트를 잡는다.
 */
describe('판매채널 site 어휘', () => {
  it('서버 어휘 SALES_CHANNELS 와 정확히 같은 키를 갖는다', () => {
    const frontKeys = Object.keys(SALES_CHANNEL_SITE_LABELS).sort();
    const serverKeys = [...SALES_CHANNELS].sort();

    expect(frontKeys).toEqual(serverKeys);
  });

  it('옵션 목록이 라벨 맵에서 파생된다', () => {
    expect(SALES_CHANNEL_SITE_OPTIONS.map((o) => o.value).sort()).toEqual(
      Object.keys(SALES_CHANNEL_SITE_LABELS).sort(),
    );
    for (const option of SALES_CHANNEL_SITE_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
    }
  });

  it('모르는 값은 그대로 보여준다', () => {
    expect(siteLabel('naver')).toBe('네이버 스마트스토어');
    expect(siteLabel('unknown_site')).toBe('unknown_site');
  });

  it('채널 형태 어휘는 서버 DTO 의 @IsEnum 배열과 같다', () => {
    expect(CHANNEL_TYPE_OPTIONS.map((o) => o.value)).toEqual([
      'ONLINE',
      'OFFLINE',
      'MARKETPLACE',
      'MOBILE_APP',
      'SOCIAL_COMMERCE',
    ]);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/admin-web/src/lib/api/domains/sales-channel/vocabulary.spec.ts --maxWorkers=2`
Expected: FAIL — `Cannot find module './vocabulary'`

(`@packages/event-contracts/*` 와 `@/*` 는 루트 jest `moduleNameMapper` 에 이미 매핑돼 있다 — `package.json:350,355`. 별도 설정이 필요 없다.)

- [ ] **Step 3: 어휘 모듈을 만든다**

`vocabulary.ts`:

```typescript
/**
 * 판매채널 화면이 쓰는 두 축의 어휘.
 *
 * - `site` = 채널 **정체** (`medusa` / `naver` / ...). 정본은 서버의 `SALES_CHANNELS` 다.
 * - `type` = 채널 **형태** (`ONLINE` / `MARKETPLACE` / ...). 정본은 서버 DTO 의 `@IsEnum` 배열이다.
 *
 * 여기 있는 것은 **표시 라벨뿐**이다. 값 목록이 서버와 갈리면 `vocabulary.spec.ts` 가 잡는다.
 * 이 파일은 순수 `.ts` 여야 한다 — admin-web 은 컴포넌트 테스트가 불가능하므로, 판정 가능한
 * 로직을 `.tsx` 밖으로 빼는 것이 유일한 검증 수단이다.
 */

export type SalesChannelSite = 'medusa' | 'naver' | 'coupang' | '3pl';

export const SALES_CHANNEL_SITE_LABELS: Record<SalesChannelSite, string> = {
  medusa: '아몬드영 (자사몰)',
  naver: '네이버 스마트스토어',
  coupang: '쿠팡',
  '3pl': '3PL',
};

export const SALES_CHANNEL_SITE_OPTIONS: ReadonlyArray<{
  value: SalesChannelSite;
  label: string;
}> = (Object.keys(SALES_CHANNEL_SITE_LABELS) as SalesChannelSite[]).map((value) => ({
  value,
  label: SALES_CHANNEL_SITE_LABELS[value],
}));

export function siteLabel(site: string): string {
  return SALES_CHANNEL_SITE_LABELS[site as SalesChannelSite] ?? site;
}

export type ChannelFormType = 'ONLINE' | 'OFFLINE' | 'MARKETPLACE' | 'MOBILE_APP' | 'SOCIAL_COMMERCE';

export const CHANNEL_TYPE_OPTIONS: ReadonlyArray<{
  value: ChannelFormType;
  label: string;
}> = [
  { value: 'ONLINE', label: '온라인' },
  { value: 'OFFLINE', label: '오프라인' },
  { value: 'MARKETPLACE', label: '오픈마켓' },
  { value: 'MOBILE_APP', label: '모바일 앱' },
  { value: 'SOCIAL_COMMERCE', label: '소셜커머스' },
];

export const DEFAULT_CHANNEL_TYPE: ChannelFormType = 'ONLINE';
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/admin-web/src/lib/api/domains/sales-channel/vocabulary.spec.ts --maxWorkers=2`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/lib/api/domains/sales-channel/vocabulary.ts \
        apps/admin-web/src/lib/api/domains/sales-channel/vocabulary.spec.ts
git commit -m "feat(admin-web): 판매채널 site/type 어휘 모듈과 서버 드리프트 가드 (#649)"
```

---

### Task 6: admin-web — DTO 에 `site` 를 추가한다

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/products.ts:336-368`

**Interfaces:**
- Produces: `CreateChannelDto` 에 `site: SalesChannelSite` (필수), `UpdateChannelDto` 에 `site?: SalesChannelSite`, `ChannelDto` 에 `site: string`. Task 7·8·9 가 이 타입을 쓴다.

- [ ] **Step 1: 타입을 고친다**

`products.ts` 의 "판매 채널 관련" 블록을 아래로 바꾼다. `ChannelType = string`(8행)은 그대로 두되 폼은 `ChannelFormType` 을 쓴다 — `ChannelType` 은 다른 곳에서도 참조되므로 이 PR 에서 좁히지 않는다.

```typescript
export interface CreateChannelDto {
  /** 채널 정체. `sales_channels.site` — 어휘 정본은 서버의 `SALES_CHANNELS` 다 */
  site: SalesChannelSite;
  /** 채널 형태. `sales_channels.type` — 생략하면 서버가 'ONLINE' 을 넣는다 */
  type?: ChannelFormType;
  name: string;
  description?: string;
  config?: Record<string, any>;
  isActive?: boolean;
}

export interface UpdateChannelDto {
  site?: SalesChannelSite;
  type?: ChannelFormType;
  name?: string;
  description?: string;
  config?: Record<string, any>;
  isActive?: boolean;
}
```

`ChannelDto` 에는 `site: string;` 를 `type` 바로 아래에 추가한다(서버 응답을 그대로 받는 자리이므로 좁은 타입을 쓰지 않는다).

파일 상단에 import 를 추가한다:

```typescript
import type { SalesChannelSite, ChannelFormType } from '@/lib/api/domains/sales-channel/vocabulary';
```

- [ ] **Step 2: 타입 체크로 파급을 본다**

Run: `npm run type-check`
Expected: `CreateChannelDto` 를 만드는 곳(form-dialog)에서 `site` 누락 에러. **이것이 정상** — Task 8 이 고친다. 다른 곳에서 에러가 나면 그 사용처를 목록으로 적어두고 Task 8 에서 함께 처리한다.

- [ ] **Step 3: 커밋 (에러가 남은 상태로 커밋하지 않는다 — Task 8 과 한 커밋으로 묶는다)**

이 Task 는 커밋하지 않고 Task 8 로 이어간다. Task 8 의 커밋이 두 변경을 함께 담는다.

---

### Task 7: core — 목록 조회에 `site` 필터를 추가한다

화면 필터가 `type` 에 site 어휘를 실어 보내 항상 0행이던 것을 고친다(발견 3).

**Files:**
- Modify: `apps/core/src/modules/catalog/core/channels/sales-channels.controller.ts:56-68`
- Modify: `apps/core/src/modules/catalog/core/channels/sales-channels.service.ts:88-116`
- Create: `apps/core/src/modules/catalog/core/channels/sales-channels.filter.spec.ts`

**Interfaces:**
- Produces: `getChannels(filters?: { isActive?, type?, site?, search?, page?, limit? })`. `GET /channels?site=naver` 가 동작한다. Task 9 가 이 쿼리를 쓴다.

- [ ] **Step 1: 실패하는 스펙을 쓴다**

`sales-channels.filter.spec.ts`:

```typescript
import { SalesChannelsService } from './sales-channels.service';
import { salesChannels } from '../../schema/catalog.schema';

/**
 * 목록 필터는 오랫동안 `type`(채널 형태) 하나뿐이었고, 화면은 거기에 `site`(채널 정체) 어휘를
 * 실어 보냈다 — 그래서 "네이버로 거르기"가 항상 0행이었다 (#649 결함 1).
 *
 * 여기서는 실제 DB 없이 `run` 을 가로채 where 절에 어떤 컬럼이 실렸는지만 본다.
 */
describe('SalesChannelsService.getChannels — site 필터', () => {
  function serviceWithCapturedWhere(): {
    service: SalesChannelsService;
    captured: { conditions: unknown[] };
  } {
    const captured = { conditions: [] as unknown[] };

    const queryBuilder = {
      from: () => queryBuilder,
      leftJoin: () => queryBuilder,
      orderBy: () => queryBuilder,
      limit: () => queryBuilder,
      offset: () => queryBuilder,
      where: (clause: unknown) => {
        captured.conditions.push(clause);
        return queryBuilder;
      },
      then: (resolve: (v: unknown) => void) => resolve([{ count: 0 }]),
    };

    const tx = { select: () => queryBuilder };
    const db = { run: (fn: (t: unknown) => unknown) => fn(tx) };

    return { service: new SalesChannelsService(db as never), captured };
  }

  it('site 필터가 주어지면 where 절이 생긴다', async () => {
    const { service, captured } = serviceWithCapturedWhere();

    await service.getChannels({ site: 'naver' });

    expect(captured.conditions.length).toBeGreaterThan(0);
    expect(JSON.stringify(captured.conditions)).toContain(salesChannels.site.name);
  });

  it('site 필터가 없으면 site 조건을 걸지 않는다', async () => {
    const { service, captured } = serviceWithCapturedWhere();

    await service.getChannels({});

    expect(JSON.stringify(captured.conditions)).not.toContain(salesChannels.site.name);
  });
});
```

**실행자 주의:** 위 목 객체는 드리즐 빌더의 최소 표면만 흉내 낸다. 실제 `getChannels` 구현이 목이 제공하지 않는 메서드를 부르면 스펙이 그 지점에서 죽는다 — 그때는 **테스트를 약화시키지 말고** 죽은 메서드를 목에 추가한다. 목이 3개 이상 더 필요해지면 그건 이 검증을 유닛으로 하기 어렵다는 신호이므로, 스펙을 지우고 대신 아래 Step 6 의 수동 확인(`GET /channels?site=medusa`)만 남긴 뒤 그 사실을 PR 본문에 적는다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/catalog/core/channels/sales-channels.filter.spec.ts --maxWorkers=2`
Expected: FAIL — 첫 테스트가 site 조건을 못 찾는다 (`getChannels` 가 `site` 를 모른다)

- [ ] **Step 3: 서비스 필터에 `site` 를 추가한다**

`sales-channels.service.ts` 의 `getChannels` 시그니처(89-95행)에 `site?: string;` 를 넣고, where 조립(107-115행)에 한 줄을 더한다:

```typescript
      if (filters?.site) {
        whereConditions.push(eq(salesChannels.site, filters.site));
      }
```

- [ ] **Step 4: 컨트롤러 쿼리에 `site` 를 추가한다**

`sales-channels.controller.ts:59-68`:

```typescript
  async getChannels(
    @Query() query: { isActive?: string; type?: string; site?: string; search?: string; page?: string; limit?: string },
  ): Promise<PaginatedResponseDto<SalesChannelDto>> {
    const filters = {
      isActive: query.isActive ? query.isActive === 'true' : undefined,
      type: query.type,
      site: query.site,
      search: query.search,
      page: query.page ? parseInt(query.page) : undefined,
      limit: query.limit ? parseInt(query.limit) : undefined,
    };
```

`@ApiQuery` 선언부(56행 근처)에도 한 줄 추가한다:

```typescript
  @ApiQuery({ name: 'site', required: false, type: String, description: '채널 정체 (medusa | naver | coupang | 3pl)' })
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx jest apps/core/src/modules/catalog/core/channels --maxWorkers=2`
Expected: 실패 0

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/catalog/core/channels/sales-channels.controller.ts \
        apps/core/src/modules/catalog/core/channels/sales-channels.service.ts \
        apps/core/src/modules/catalog/core/channels/sales-channels.filter.spec.ts
git commit -m "feat(catalog): 판매채널 목록에 site 필터를 추가한다 (#649)"
```

---

### Task 8: admin-web — 폼의 두 축을 분리한다

이 계획의 본류. `site` 를 보내지 않아 항상 400 이던 생성 경로를 연다.

**Files:**
- Create: `apps/admin-web/src/features/sales-channel/form-payload.ts`
- Create: `apps/admin-web/src/features/sales-channel/form-payload.spec.ts`
- Modify: `apps/admin-web/src/features/sales-channel/components/form-dialog/index.tsx`
- Modify: `apps/admin-web/src/lib/types/dto/products.ts` (Task 6 의 변경을 여기서 함께 커밋)

**Interfaces:**
- Consumes: `SalesChannelSite`, `ChannelFormType`, `DEFAULT_CHANNEL_TYPE` (Task 5), `CreateChannelDto`/`UpdateChannelDto` (Task 6)
- Produces:
  - `type SalesChannelFormState = { site: string; type: string; name: string; memo: string; feeRate: string; smartstoreUrl: string; companyCode: string; shipperName: string; shipperPhone: string; shipperZip: string; shipperAddress: string; isActive: boolean }`
  - `buildCreatePayload(form: SalesChannelFormState): CreateChannelDto | null`
  - `buildUpdatePayload(form: SalesChannelFormState): UpdateChannelDto`
  - `null` 은 "필수값 미충족 — 제출하지 않는다" 를 뜻한다.

**설계 메모 — 수정 시 `site` 는 읽기 전용으로 둔다.** `site` 는 채널의 **정체**이고, `channel-listing.service.ts:117-121` 의 리스팅 조회가 `eq(salesChannels.site, channelCode)` 로 그 값에 걸린다. 기존 채널의 `site` 를 바꾸면 그 채널에 매달린 모든 `channel_variant_listings` 가 조용히 다른 채널의 것이 된다. 만들 때 정하고 이후엔 못 바꾸게 한다 — 바꿔야 하면 새 채널을 만드는 게 맞다.

- [ ] **Step 1: 실패하는 payload 스펙을 쓴다**

`form-payload.spec.ts`:

```typescript
import { buildCreatePayload, buildUpdatePayload, type SalesChannelFormState } from './form-payload';

/**
 * 이 화면으로는 판매채널을 만든 적이 없다 — 폼이 `site` 를 아예 안 보내고 `type` 에 site 어휘를
 * 실어 보내 항상 400 이었다 (#649 결함 1). admin-web 은 컴포넌트 테스트가 불가능하므로
 * payload 조립을 순수 함수로 뽑아 여기서 못 박는다.
 */
describe('판매채널 폼 payload', () => {
  function form(overrides: Partial<SalesChannelFormState> = {}): SalesChannelFormState {
    return {
      site: 'naver',
      type: 'MARKETPLACE',
      name: '네이버 스마트스토어',
      memo: '',
      feeRate: '',
      smartstoreUrl: '',
      companyCode: '',
      shipperName: '',
      shipperPhone: '',
      shipperZip: '',
      shipperAddress: '',
      isActive: true,
      ...overrides,
    };
  }

  describe('buildCreatePayload', () => {
    it('site 와 type 을 각각 실어 보낸다', () => {
      const payload = buildCreatePayload(form());

      expect(payload).not.toBeNull();
      expect(payload!.site).toBe('naver');
      expect(payload!.type).toBe('MARKETPLACE');
      expect(payload!.name).toBe('네이버 스마트스토어');
    });

    it('type 을 안 고르면 ONLINE 을 기본으로 보낸다', () => {
      const payload = buildCreatePayload(form({ type: '' }));

      expect(payload!.type).toBe('ONLINE');
    });

    it('site 가 비면 제출하지 않는다', () => {
      expect(buildCreatePayload(form({ site: '' }))).toBeNull();
    });

    it('이름이 비면 제출하지 않는다', () => {
      expect(buildCreatePayload(form({ name: '  ' }))).toBeNull();
    });

    it('site 어휘 밖의 값은 제출하지 않는다', () => {
      // 옛 프런트 상수가 쓰던 값. 서버가 400 을 내기 전에 여기서 끊는다.
      expect(buildCreatePayload(form({ site: 'naver_smartstore' }))).toBeNull();
    });

    it('빈 부가 정보는 config 에 넣지 않는다', () => {
      const payload = buildCreatePayload(form());

      expect(payload!.config).toEqual({});
    });

    it('출고지는 한 필드라도 차면 통째로 싣는다', () => {
      const payload = buildCreatePayload(form({ shipperName: '부천창고' }));

      expect(payload!.config!.shipper).toEqual({
        name: '부천창고',
        phone: '',
        zipcode: '',
        address: '',
      });
    });

    it('수수료율은 숫자로 바꿔 싣는다', () => {
      const payload = buildCreatePayload(form({ feeRate: '5.5' }));

      expect(payload!.config!.feeRate).toBe(5.5);
    });
  });

  describe('buildUpdatePayload', () => {
    it('site 를 보내지 않는다 — 채널 정체는 만든 뒤 바꿀 수 없다', () => {
      const payload = buildUpdatePayload(form());

      expect(payload).not.toHaveProperty('site');
    });

    it('활성 여부를 싣는다', () => {
      expect(buildUpdatePayload(form({ isActive: false })).isActive).toBe(false);
    });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/admin-web/src/features/sales-channel/form-payload.spec.ts --maxWorkers=2`
Expected: FAIL — `Cannot find module './form-payload'`

- [ ] **Step 3: payload 빌더를 만든다**

`form-payload.ts`:

```typescript
import type { CreateChannelDto, UpdateChannelDto } from '@/lib/types/dto/products';
import {
  DEFAULT_CHANNEL_TYPE,
  SALES_CHANNEL_SITE_LABELS,
  type ChannelFormType,
  type SalesChannelSite,
} from '@/lib/api/domains/sales-channel/vocabulary';

export type SalesChannelFormState = {
  /** 채널 정체 — `sales_channels.site` */
  site: string;
  /** 채널 형태 — `sales_channels.type` */
  type: string;
  name: string;
  memo: string;
  feeRate: string;
  smartstoreUrl: string;
  companyCode: string;
  shipperName: string;
  shipperPhone: string;
  shipperZip: string;
  shipperAddress: string;
  isActive: boolean;
};

function isKnownSite(site: string): site is SalesChannelSite {
  return Object.prototype.hasOwnProperty.call(SALES_CHANNEL_SITE_LABELS, site);
}

function resolveType(type: string): ChannelFormType {
  return type ? (type as ChannelFormType) : DEFAULT_CHANNEL_TYPE;
}

function buildConfig(form: SalesChannelFormState): Record<string, unknown> {
  const hasShipper =
    Boolean(form.shipperName) ||
    Boolean(form.shipperPhone) ||
    Boolean(form.shipperZip) ||
    Boolean(form.shipperAddress);

  const config: Record<string, unknown> = {};
  if (form.memo) config.memo = form.memo;
  if (form.feeRate) config.feeRate = Number(form.feeRate);
  if (form.site === 'naver' && form.smartstoreUrl) config.smartstoreUrl = form.smartstoreUrl;
  if (form.site === 'coupang' && form.companyCode) config.companyCode = form.companyCode;
  if (hasShipper) {
    config.shipper = {
      name: form.shipperName,
      phone: form.shipperPhone,
      zipcode: form.shipperZip,
      address: form.shipperAddress,
    };
  }
  return config;
}

/** 필수값이 안 찼거나 어휘 밖의 site 면 `null` — 호출자는 제출하지 않는다. */
export function buildCreatePayload(form: SalesChannelFormState): CreateChannelDto | null {
  if (!isKnownSite(form.site)) return null;
  if (!form.name.trim()) return null;

  return {
    site: form.site,
    type: resolveType(form.type),
    name: form.name.trim(),
    config: buildConfig(form),
  };
}

/**
 * `site` 는 싣지 않는다. 채널 정체를 바꾸면 그 채널에 매달린 `channel_variant_listings` 가
 * 조용히 다른 채널의 것이 된다 (`channel-listing.service.ts` 의 `eq(salesChannels.site, ...)`).
 * 정체를 바꿔야 하면 새 채널을 만드는 게 맞다.
 */
export function buildUpdatePayload(form: SalesChannelFormState): UpdateChannelDto {
  return {
    type: resolveType(form.type),
    name: form.name.trim(),
    isActive: form.isActive,
    config: buildConfig(form),
  };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/admin-web/src/features/sales-channel/form-payload.spec.ts --maxWorkers=2`
Expected: PASS (10 tests)

- [ ] **Step 5: 폼 다이얼로그를 두 축으로 바꾼다**

`form-dialog/index.tsx` 에서:

1. import 를 교체한다 — `useSalesChannelSites` 를 버리고 어휘 모듈과 payload 빌더를 가져온다:

```typescript
import { useCreateChannel, useUpdateChannel } from '@/lib/api/domains/sales-channel';
import {
  SALES_CHANNEL_SITE_OPTIONS,
  CHANNEL_TYPE_OPTIONS,
  siteLabel,
} from '@/lib/api/domains/sales-channel/vocabulary';
import {
  buildCreatePayload,
  buildUpdatePayload,
  type SalesChannelFormState,
} from '../../form-payload';
```

2. `formData` 를 `SalesChannelFormState` 로 선언하고 초기값에 `site: ''`, `type: ''` 를 둔다. `resetForm` 도 같은 모양으로 맞춘다.

3. 편집 모드 `useEffect` 의 매핑에 `site: editingChannel.site || ''` 를 추가하고, `type` 은 `editingChannel.type || ''` 를 유지한다.

4. `selectedType` / `isSmartstore` / `isCoupang` 을 site 기준으로 바꾼다:

```typescript
  const isNaver = formData.site === 'naver';
  const isCoupang = formData.site === 'coupang';
```

`useMemo` 와 그 import 가 더 안 쓰이면 제거한다.

5. `handleSubmit` 을 빌더 호출로 바꾼다:

```typescript
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      if (editingChannel) {
        await updateChannel.mutateAsync({
          id: editingChannel.id,
          data: buildUpdatePayload(formData),
        });
      } else {
        const payload = buildCreatePayload(formData);
        if (!payload) return;
        await createChannel.mutateAsync(payload);
      }
      onSuccess();
    } catch {
      /* Alert로 표시됨 */
    }
  };
```

6. "채널 타입" 드롭다운 하나를 **두 개**로 바꾼다. 기존 블록(286-309행)을 아래로 교체한다:

```tsx
                {/* 채널 정체 — sales_channels.site. 만든 뒤에는 바꿀 수 없다. */}
                <div className="flex items-center gap-4">
                  <Label className="text-gray-900 min-w-[100px] flex items-center gap-1">
                    <span className="text-red-500">■</span>
                    판매처
                  </Label>
                  {editingChannel ? (
                    <div className="flex-1 text-sm text-gray-700">
                      {siteLabel(formData.site)}
                      <span className="ml-2 text-xs text-gray-500">
                        (등록 후에는 변경할 수 없습니다)
                      </span>
                    </div>
                  ) : (
                    <Select
                      value={formData.site}
                      onValueChange={(v) => setFormData((p) => ({ ...p, site: v }))}
                    >
                      <SelectTrigger className="flex-1 bg-white border-gray-300">
                        <SelectValue placeholder="판매처를 선택하세요" />
                      </SelectTrigger>
                      <SelectContent className="bg-white">
                        {SALES_CHANNEL_SITE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {/* 채널 형태 — sales_channels.type */}
                <div className="flex items-center gap-4">
                  <Label className="text-gray-900 min-w-[100px]">채널 형태</Label>
                  <Select
                    value={formData.type}
                    onValueChange={(v) => setFormData((p) => ({ ...p, type: v }))}
                  >
                    <SelectTrigger className="flex-1 bg-white border-gray-300">
                      <SelectValue placeholder="온라인" />
                    </SelectTrigger>
                    <SelectContent className="bg-white">
                      {CHANNEL_TYPE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
```

7. "타입별 추가 정보" 섹션의 조건을 `(isNaver || isCoupang)` 로, 내부 분기를 `isNaver` / `isCoupang` 으로 바꾼다.

8. 제출 버튼의 disabled 조건을 바꾼다:

```tsx
                disabled={isLoading || (!editingChannel && !formData.site) || !formData.name}
```

`isLoading` 에서 `sitesLoading` 을 뺀다(훅을 더 안 쓴다).

- [ ] **Step 6: 타입 체크와 스펙**

Run: `npm run type-check`
Expected: 에러 0 (Task 6 이 만든 에러가 여기서 해소된다)

Run: `npm run test:admin-web`
Expected: 실패 0

- [ ] **Step 7: 커밋**

```bash
git add apps/admin-web/src/lib/types/dto/products.ts \
        apps/admin-web/src/features/sales-channel/form-payload.ts \
        apps/admin-web/src/features/sales-channel/form-payload.spec.ts \
        apps/admin-web/src/features/sales-channel/components/form-dialog/index.tsx
git commit -m "fix(admin-web): 판매채널 폼이 site 와 type 을 각각 보내게 한다 (#649)"
```

---

### Task 9: admin-web — 표와 필터를 site 축으로 옮긴다

**Files:**
- Modify: `apps/admin-web/src/hooks/table/columns/use-sales-channel-table-columns.tsx`
- Modify: `apps/admin-web/src/features/sales-channel/components/filter-box/index.tsx`
- Modify: `apps/admin-web/src/hooks/table/query/use-sales-channel-table-query.ts`
- Modify: `apps/admin-web/src/features/sales-channel/components/table/index.tsx`

**Interfaces:**
- Consumes: `siteLabel`, `SALES_CHANNEL_SITE_OPTIONS` (Task 5), `GET /channels?site=` (Task 7)
- Produces: `SalesChannelFilters({ filters: { site?, search? }, onFilterChange })` — `sites` prop 이 사라진다.

**설계 메모 — `SalesChannelMark` 를 쓰지 않는다.** 그 컴포넌트의 타입은 site 도 type 도 아닌 세 번째 어휘(`'almondyoung' | 'naver_smartstore' | ...`)이고, 참조하는 `/icons/*_mark.png` 자산이 저장소에 없다(발견 4·5). 판매채널 표에서는 `siteLabel()` 텍스트로 바꾼다. 다른 화면의 사용처는 이 PR 에서 건드리지 않는다.

- [ ] **Step 1: 컬럼을 바꾼다**

`use-sales-channel-table-columns.tsx` 의 첫 컬럼(24-29행)을 두 개로 교체하고, `SalesChannelMark` import 를 지운다:

```tsx
      columnHelper.accessor('site', {
        header: '판매처',
        cell: ({ getValue }) => (
          <span className="text-sm font-medium">{siteLabel(getValue() as string)}</span>
        ),
      }),
      columnHelper.accessor('type', {
        header: '채널 형태',
        cell: ({ getValue }) => (
          <span className="text-sm text-gray-600">{(getValue() as string) || '-'}</span>
        ),
      }),
```

import 추가:

```typescript
import { siteLabel } from '@/lib/api/domains/sales-channel/vocabulary';
```

- [ ] **Step 2: 쿼리 파라미터를 `site` 로 바꾼다**

`use-sales-channel-table-query.ts`:

```typescript
  const queryObject = useQueryParams(['page', 'site', 'search']);

  const { page, site, search } = queryObject;

  const searchParams: ChannelsQuery = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    site: site || undefined,
    search: search || undefined,
  };
```

`ChannelsQuery`(`products.ts`)에 `site?: string;` 를 추가한다.

- [ ] **Step 3: 필터 박스를 바꾼다**

`filter-box/index.tsx` 에서 `UiSite` 타입과 `sites` prop 을 지우고 어휘 모듈을 쓴다:

```typescript
import { SALES_CHANNEL_SITE_OPTIONS } from '@/lib/api/domains/sales-channel/vocabulary';

type FilterState = { site?: string; search?: string };

interface SalesChannelFiltersProps {
  filters: FilterState;
  onFilterChange: (updates: Record<string, string | undefined>) => void;
}
```

핸들러와 JSX:

```tsx
  const handleSiteChange = (value: string) => {
    onFilterChange({ site: value === 'all' ? undefined : value });
  };

  const clearFilters = () => {
    onFilterChange({ site: undefined, search: undefined });
  };
```

```tsx
        <label className="text-sm font-medium text-gray-700">판매처:</label>
        <Select value={filters.site || 'all'} onValueChange={handleSiteChange}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="전체" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체</SelectItem>
            {SALES_CHANNEL_SITE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
```

- [ ] **Step 4: 표에서 배선을 맞춘다**

`components/table/index.tsx`:
- `useSalesChannelSites` import 와 호출(41-42행)을 지운다
- `<SalesChannelFilters filters={{ site: raw.site, search: raw.search }} onFilterChange={...} />` 로 바꾸고 `sites` prop 을 뺀다
- `DataTable` 의 `isLoading={isLoading || sitesLoading}` 을 `isLoading={isLoading}` 으로 바꾼다

- [ ] **Step 5: 타입 체크와 스펙**

Run: `npm run type-check`
Expected: 에러 0

Run: `npm run test:admin-web`
Expected: 실패 0

- [ ] **Step 6: 커밋**

```bash
git add apps/admin-web/src/hooks/table apps/admin-web/src/features/sales-channel apps/admin-web/src/lib/types/dto/products.ts
git commit -m "fix(admin-web): 판매채널 표·필터를 site 축으로 옮긴다 (#649)"
```

---

### Task 10: 죽은 프런트 상수를 제거한다

서버와 갈렸던 두 번째 정본을 없앤다. 남겨두면 다음 사람이 다시 쓴다.

**Files:**
- Modify: `apps/admin-web/src/lib/api/domains/sales-channel/queries.ts:17-27,62-77`

- [ ] **Step 1: 사용처가 0인지 확인한다**

Run: `grep -rn "SALES_CHANNEL_SITES\|useSalesChannelSites\|channelQueryKeys.sites\|useChannelsByType" apps/admin-web/src`
Expected: `queries.ts` 자기 자신 외에 0건. 다른 사용처가 나오면 그것부터 어휘 모듈로 옮긴다.

- [ ] **Step 2: 지운다**

`queries.ts` 에서 `SALES_CHANNEL_SITES` 상수(17-27행), `useSalesChannelSites` 훅(69-77행), `channelQueryKeys.sites`(14행)를 제거한다. `useChannelsByType` 도 Step 1 에서 사용처 0으로 확인됐다면 함께 지운다.

- [ ] **Step 3: 타입 체크와 전체 게이트**

```bash
npm run type-check
npx jest --maxWorkers=2
npm run test:admin-web
```
Expected: 셋 다 실패 0

- [ ] **Step 4: 커밋**

```bash
git add apps/admin-web/src/lib/api/domains/sales-channel/queries.ts
git commit -m "chore(admin-web): 서버와 갈렸던 판매채널 site 하드코딩 상수를 제거한다 (#649)"
```

---

## PR 2 마무리 — 브라우저 스모크 (필수)

**테스트 초록은 배선이 살아있다는 증거가 아니다.** admin-web 은 컴포넌트 테스트가 불가능하므로 아래가 유일한 판정이다. core 를 먼저 띄우고(Task 7 의 `site` 필터가 필요하다) admin-web 을 붙인다.

- [ ] `/account/sales-channel` 이 열리고 기존 medusa 행이 **"아몬드영 (자사몰)"** 로 보인다 (전에는 빨간 "Unknown")
- [ ] "판매처 등록" → 판매처 드롭다운에 **medusa / 네이버 스마트스토어 / 쿠팡 / 3PL 넷만** 보인다 (`phone_order`·`other` 없음)
- [ ] 판매처 = 네이버 스마트스토어, 채널 형태 = 오픈마켓, 이름 입력 → 등록 성공 (**전에는 항상 400**)
- [ ] 등록된 행의 판매처가 "네이버 스마트스토어", 채널 형태가 "MARKETPLACE"
- [ ] 그 행 수정 → 판매처가 **읽기 전용 텍스트**로 보이고 채널 형태만 바뀐다. 저장 성공
- [ ] 필터에서 "네이버 스마트스토어" 선택 → 방금 만든 행만 보인다 (**전에는 항상 0행**)
- [ ] 폼 어디에도 API 키·비밀번호 입력란이 없다. 표에 "API 인증키 수정" 버튼과 로그인 아이디·비밀번호 컬럼이 없다 (PR 1 결과 재확인)
- [ ] `GET /channels` 응답 JSON 에 `credentials` 키가 없다 (브라우저 네트워크 탭)

- [ ] **DB 확인** — 실제로 원하던 행이 생겼는지:

```sql
SELECT id, site, type, name, is_active FROM sales_channels ORDER BY created_at;
```
기대: `site='naver'` 행이 존재하고 `type` 이 `MARKETPLACE`.

- [ ] **PR 생성** — 제목 `fix(admin-web,catalog): 판매채널 폼의 type/site 혼동을 바로잡는다 (#649 결함 1)`. 본문에 마이그레이션 0건, **결함 2(`is_active` 집행)는 이 PR 밖**, core 선배포 필요(`site` 필터) 를 명시한다.

## 배포 순서

1. PR 1 머지 → `sst deploy` (core + admin-web)
2. 라이브에서 `GET /channels` 응답에 `credentials` 가 없는 것 확인
3. PR 2 머지 → `sst deploy` — **core 가 admin-web 보다 먼저**여야 한다. `site` 필터 없이 새 admin-web 이 뜨면 목록 필터가 무시된다(500 은 아니지만 조용히 안 걸린다)
4. 브라우저에서 `site='naver'` 채널을 실제로 생성 — 이것이 #643 의 선행 해소 지점이다

마이그레이션은 두 PR 모두 0건이므로 `migrate` 호출이 필요 없다.

## 후속

- **#649 결함 2** (`is_active` 집행) — 별도 계획. #643 개통 전 필요
- **#650 컬럼 DROP** — expand-contract 2 PR. 서두를 것 없음
- **`SalesChannelMark` 자산 부재** — 주문 매칭 표·지역별 송장 표가 여전히 이 컴포넌트를 쓴다. 별도 이슈감
