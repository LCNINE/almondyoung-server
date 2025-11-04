---
inclusion: false
---

# 프론트엔드 코드 작성 규칙: 가독성 및 예측 가능성

이 문서는 프론트엔드 코드를 작성할 때 가독성과 예측 가능성을 높이기 위한 규칙을 정의합니다.

## 1. 복잡한 조건에 이름 붙이기

복잡한 조건식이 특별한 이름 없이 사용되면, 조건이 뜻하는 바를 한눈에 파악하기 어렵습니다.

### 나쁜 예시

```typescript
const result = products.filter((product) =>
  product.categories.some((category) =>
    category.id === targetCategory.id &&
    product.prices.some((price) => price >= minPrice && price <= maxPrice)
  )
);
```

### 좋은 예시

```typescript
const matchedProducts = products.filter((product) => {
  return product.categories.some((category) => {
    const isSameCategory = category.id === targetCategory.id;
    const isPriceInRange = product.prices.some(
      (price) => price >= minPrice && price <= maxPrice
    );
ㅈ
    return isSameCategory && isPriceInRange;
  });
});
```

**규칙**: 복잡한 조건식에는 명시적인 이름을 붙여서 코드를 읽는 사람이 한 번에 고려해야 할 맥락을 줄이세요.

**언제 조건에 이름을 붙이는가?**
- 복잡한 로직을 다룰 때 (여러 줄에 걸친 조건)
- 재사용성이 필요할 때
- 단위 테스트가 필요할 때

**언제 이름을 붙이지 않아도 되는가?**
- 로직이 간단할 때 (예: `arr.map(x => x * 2)`)
- 한 번만 사용될 때

## 2. 매직 넘버에 이름 붙이기

매직 넘버란 정확한 뜻을 밝히지 않고 소스 코드 안에 직접 숫자 값을 넣는 것을 말합니다.

### 나쁜 예시

```typescript
async function onLikeClick() {
  await postLike(url);
  await delay(300);
  await refetchPostLike();
}
```

### 좋은 예시

```typescript
const ANIMATION_DELAY_MS = 300;

async function onLikeClick() {
  await postLike(url);
  await delay(ANIMATION_DELAY_MS);
  await refetchPostLike();
}
```

**규칙**: 숫자의 맥락을 정확하게 표시하기 위해서 상수로 선언하세요.

## 3. 구현 상세 추상화하기

한 사람이 코드를 읽을 때 동시에 고려할 수 있는 총 맥락의 숫자는 제한되어 있습니다(약 6~7개). 불필요한 맥락을 추상화하여 코드를 쉽게 읽을 수 있도록 하세요.

### 나쁜 예시

```tsx
function LoginStartPage() {
  useCheckLogin({
    onChecked: (status) => {
      if (status === "LOGGED_IN") location.href = "/home";
    }
  });
  /* ... 로그인 관련 로직 ... */
  return <>{/* ... 로그인 관련 컴포넌트 ... */}</>;
}
```

### 좋은 예시 (Wrapper 컴포넌트)

```tsx
function App() {
  return (
    <AuthGuard>
      <LoginStartPage />
    </AuthGuard>
  );
}

function AuthGuard({ children }) {
  const status = useCheckLoginStatus();

  useEffect(() => {
    if (status === "LOGGED_IN") {
      location.href = "/home";
    }
  }, [status]);

  return status !== "LOGGED_IN" ? children : null;
}

function LoginStartPage() {
  /* ... 로그인 관련 로직 ... */
  return <>{/* ... 로그인 관련 컴포넌트 ... */}</>;
}
```

**규칙**: 사용자가 로그인되었는지 확인하고 이동하는 로직을 HOC(Higher-Order Component)나 Wrapper 컴포넌트로 분리하여, 코드를 읽는 사람이 한 번에 알아야 하는 맥락을 줄이세요.

**추상화의 원리**: 글에서 "왼쪽으로 10걸음 걸어라"라는 문장도 수많은 추상화의 결과입니다. "북쪽을 바라보았을 때 한 번의 회전을 360등분한 각의 90배만큼..."처럼 모든 것을 풀어쓰면 이해하기 어렵습니다. 코드도 마찬가지로 적절한 추상화가 필요합니다.

## 4. 같이 실행되지 않는 코드 분리하기

동시에 실행되지 않는 코드가 하나의 함수 또는 컴포넌트에 있으면, 동작을 한눈에 파악하기 어렵습니다.

### 나쁜 예시

```tsx
function SubmitButton() {
  const isViewer = useRole() === "viewer";
  useEffect(() => {
    if (isViewer) return;
    showButtonAnimation();
  }, [isViewer]);
  return isViewer ? <TextButton disabled>Submit</TextButton> : <Button type="submit">Submit</Button>;
}
```

### 좋은 예시

```tsx
function SubmitButton() {
  const isViewer = useRole() === "viewer";
  return isViewer ? <ViewerSubmitButton /> : <AdminSubmitButton />;
}

function ViewerSubmitButton() {
  return <TextButton disabled>Submit</TextButton>;
}

function AdminSubmitButton() {
  useEffect(() => {
    showButtonAnimation();
  }, []);
  return <Button type="submit">Submit</Button>;
}
```

**규칙**: 사용자가 가질 수 있는 여러 상태를 하나의 컴포넌트 안에서 한 번에 처리하지 말고, 각 상태별로 컴포넌트를 분리하세요.

## 5. 삼항 연산자 단순하게 하기

삼항 연산자를 복잡하게 사용하면 조건의 구조가 명확하게 보이지 않아서 코드를 읽기 어렵습니다.

### 나쁜 예시

```typescript
const status =
  A조건 && B조건 ? "BOTH" : A조건 || B조건 ? (A조건 ? "A" : "B") : "NONE";
```

### 좋은 예시

```typescript
const status = (() => {
  if (A조건 && B조건) return "BOTH";
  if (A조건) return "A";
  if (B조건) return "B";
  return "NONE";
})();
```

**규칙**: 조건을 `if` 문으로 풀어서 사용하면 보다 명확하고 간단하게 조건을 드러낼 수 있습니다.

## 6. 시점 이동 줄이기

코드를 읽을 때 코드의 위아래를 왔다갔다 하면서 읽거나, 여러 파일이나 함수, 변수를 넘나들면서 읽는 것을 시점 이동이라고 합니다.

### 나쁜 예시

```tsx
function Page() {
  const user = useUser();
  const policy = getPolicyByRole(user.role); // 3번의 시점 이동 발생

  return (
    <div>
      <Button disabled={!policy.canInvite}>Invite</Button>
      <Button disabled={!policy.canView}>View</Button>
    </div>
  );
}

function getPolicyByRole(role) {
  const policy = POLICY_SET[role];
  return {
    canInvite: policy.includes("invite"),
    canView: policy.includes("view")
  };
}

const POLICY_SET = { admin: ["invite", "view"], viewer: ["view"] };
```

### 좋은 예시 (조건을 펼쳐서 그대로 드러내기)

```tsx
function Page() {
  const user = useUser();

  switch (user.role) {
    case "admin":
      return (
        <div>
          <Button disabled={false}>Invite</Button>
          <Button disabled={false}>View</Button>
        </div>
      );
    case "viewer":
      return (
        <div>
          <Button disabled={true}>Invite</Button>
          <Button disabled={false}>View</Button>
        </div>
      );
    default:
      return null;
  }
}
```

### 좋은 예시 (조건을 한눈에 볼 수 있는 객체로 만들기)

```tsx
function Page() {
  const user = useUser();
  const policy = {
    admin: { canInvite: true, canView: true },
    viewer: { canInvite: false, canView: true }
  }[user.role];

  return (
    <div>
      <Button disabled={!policy.canInvite}>Invite</Button>
      <Button disabled={!policy.canView}>View</Button>
    </div>
  );
}
```

**규칙**: 권한에 따른 조건을 요구사항 그대로 코드에 드러내거나, 조건을 한눈에 볼 수 있는 객체로 만들어서 시점 이동을 줄이세요.

## 7. 로직 종류에 따라 합쳐진 함수 쪼개기

쿼리 파라미터, 상태, API 호출과 같은 로직의 종류에 따라서 함수나 컴포넌트, Hook을 만들지 마세요.

### 나쁜 예시

```typescript
export function usePageState() {
  const [query, setQuery] = useQueryParams({
    cardId: NumberParam,
    statementId: NumberParam,
    dateFrom: DateParam,
    dateTo: DateParam,
    statusList: ArrayParam
  });

  return useMemo(() => ({
    values: {
      cardId: query.cardId ?? undefined,
      statementId: query.statementId ?? undefined,
      dateFrom: query.dateFrom == null ? defaultDateFrom : moment(query.dateFrom),
      dateTo: query.dateTo == null ? defaultDateTo : moment(query.dateTo),
      statusList: query.statusList as StatementStatusType[] | undefined
    },
    controls: {
      setCardId: (cardId: number) => setQuery({ cardId }, "replaceIn"),
      // ... 나머지 setter 함수들
    }
  }), [query, setQuery]);
}
```

### 좋은 예시

```typescript
import { useQueryParam } from "use-query-params";

export function useCardIdQueryParam() {
  const [cardId, _setCardId] = useQueryParam("cardId", NumberParam);

  const setCardId = useCallback((cardId: number) => {
    _setCardId({ cardId }, "replaceIn");
  }, []);

  return [cardId ?? undefined, setCardId] as const;
}
```

**규칙**: 각각의 쿼리 파라미터별로 별도의 Hook을 작성하여 Hook이 담당하는 책임을 분리하세요.

## 8. 숨은 로직 드러내기

함수나 컴포넌트의 이름, 파라미터, 반환 값에 드러나지 않는 숨은 로직이 있다면, 함께 협업하는 동료들이 동작을 예측하는 데에 어려움을 겪을 수 있습니다.

### 나쁜 예시

```typescript
async function fetchBalance(): Promise<number> {
  const balance = await http.get<number>("...");

  logging.log("balance_fetched");

  return balance;
}
```

### 좋은 예시

```typescript
async function fetchBalance(): Promise<number> {
  const balance = await http.get<number>("...");

  return balance;
}
```

```tsx
<Button
  onClick={async () => {
    const balance = await fetchBalance();
    logging.log("balance_fetched");

    await syncBalance(balance);
  }}
>
  계좌 잔액 갱신하기
</Button>
```

**규칙**: 함수의 이름과 파라미터, 반환 타입으로 예측할 수 있는 로직만 구현 부분에 남기세요. 로깅을 하는 코드는 별도로 분리하세요.

## 9. 이름 겹치지 않게 관리하기

같은 이름을 가지는 함수나 변수는 동일한 동작을 해야 합니다. 작은 동작 차이가 코드의 예측 가능성을 낮추고, 코드를 읽는 사람에게 혼란을 줄 수 있습니다.

### 나쁜 예시

```typescript
// http.ts
import { http as httpLibrary } from "@some-library/http";

export const http = {
  async get(url: string) {
    const token = await fetchToken();

    return httpLibrary.get(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }
};
```

```typescript
// fetchUser.ts
import { http } from "./http";

export async function fetchUser() {
  return http.get("...");
}
```

### 좋은 예시

```typescript
// httpService.ts
import { http as httpLibrary } from "@some-library/http";

export const httpService = {
  async getWithAuth(url: string) {
    const token = await fetchToken();

    return httpLibrary.get(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }
};
```

```typescript
// fetchUser.ts
import { httpService } from "./httpService";

export async function fetchUser() {
  return await httpService.getWithAuth("...");
}
```

**규칙**: 서비스에서 만든 함수에는 라이브러리의 함수명과 구분되는 명확한 이름을 사용해서 함수의 동작을 예측 가능하게 만드세요.

## 10. 같은 종류의 함수는 반환 타입 통일하기

API 호출과 관련된 Hook들처럼 같은 종류의 함수나 Hook이 서로 다른 반환 타입을 가지면 코드의 일관성이 떨어집니다.

### 나쁜 예시

```typescript
function useUser() {
  return useQuery({ queryKey: ["user"], queryFn: fetchUser });
}

function useServerTime() {
  const query = useQuery({ queryKey: ["serverTime"], queryFn: fetchServerTime });
  return query.data; // ❌ 데이터만 반환
}
```

### 좋은 예시

```typescript
function useUser() {
  return useQuery({ queryKey: ["user"], queryFn: fetchUser });
}

function useServerTime() {
  return useQuery({ queryKey: ["serverTime"], queryFn: fetchServerTime }); // ✅ Query 객체 반환
}
```

**규칙**: 서버 API를 호출하는 Hook은 일관적으로 `Query` 객체를 반환하게 하여 팀원들이 코드에 대한 예측 가능성을 높이세요.

**추가 예시: 검증 함수**

```typescript
// ❌ 나쁜 예시: 반환 타입이 다름
function checkIsNameValid(name: string) {
  return name.length > 0 && name.length < 20; // boolean 반환
}

function checkIsAgeValid(age: number) {
  if (!Number.isInteger(age)) {
    return { ok: false, reason: "나이는 정수여야 해요." }; // 객체 반환
  }
  // ...
}

// ✅ 좋은 예시: 일관된 반환 타입
type ValidationResult = { ok: true } | { ok: false; reason: string };

function checkIsNameValid(name: string): ValidationResult {
  if (name.length === 0) return { ok: false, reason: "이름을 입력해주세요." };
  if (name.length >= 20) return { ok: false, reason: "이름은 20자 미만이어야 해요." };
  return { ok: true };
}

function checkIsAgeValid(age: number): ValidationResult {
  if (!Number.isInteger(age)) return { ok: false, reason: "나이는 정수여야 해요." };
  if (age < 18) return { ok: false, reason: "나이는 18세 이상이어야 해요." };
  return { ok: true };
}
```
