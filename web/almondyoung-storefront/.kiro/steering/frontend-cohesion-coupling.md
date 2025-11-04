---
inclusion: false
---

# 프론트엔드 코드 작성 규칙: 응집도 및 결합도

이 문서는 프론트엔드 코드를 작성할 때 응집도를 높이고 결합도를 낮추기 위한 규칙을 정의합니다.

## 1. 함께 수정되는 파일을 같은 디렉토리에 두기

프로젝트에서 코드를 작성하다 보면 Hook, 컴포넌트, 유틸리티 함수 등을 여러 파일로 나누어서 관리하게 됩니다. 함께 수정되는 소스 파일을 하나의 디렉토리에 배치하면 코드의 의존 관계를 명확하게 드러낼 수 있습니다.

### 나쁜 예시

```text
└─ src
   ├─ components
   ├─ constants
   ├─ containers
   ├─ contexts
   ├─ remotes
   ├─ hooks
   ├─ utils
   └─ ...
```

### 좋은 예시

```text
└─ src
   │  // 전체 프로젝트에서 사용되는 코드
   ├─ components
   ├─ containers
   ├─ hooks
   ├─ utils
   ├─ ...
   │
   └─ domains
      │  // Domain1에서만 사용되는 코드
      ├─ Domain1
      │     ├─ components
      │     ├─ containers
      │     ├─ hooks
      │     ├─ utils
      │     └─ ...
      │
      │  // Domain2에서만 사용되는 코드
      └─ Domain2
            ├─ components
            ├─ containers
            ├─ hooks
            ├─ utils
            └─ ...
```

**규칙**: 함께 수정되는 코드 파일끼리 하나의 디렉토리를 이루도록 구조를 개선하세요. 한 도메인의 하위 코드에서 다른 도메인의 소스 코드를 참조하는 것은 잘못된 파일을 참조하고 있다는 것을 의미합니다.

## 2. 매직 넘버 없애기 (응집도 관점)

매직 넘버를 사용하면 같이 수정되어야 할 코드 중 한쪽만 수정될 위험성이 있습니다.

### 나쁜 예시

```typescript
async function onLikeClick() {
  await postLike(url);
  await delay(300);
  await refetchPostLike();
}
```

만약 `300`이라고 하는 숫자를 애니메이션 완료를 기다리려고 사용했다면, 재생하는 애니메이션을 바꿨을 때 조용히 서비스가 깨질 수 있는 위험성이 있습니다.

### 좋은 예시

```typescript
const ANIMATION_DELAY_MS = 300;

async function onLikeClick() {
  await postLike(url);
  await delay(ANIMATION_DELAY_MS);
  await refetchPostLike();
}
```

**규칙**: 숫자의 맥락을 정확하게 표시하기 위해서 상수로 선언하세요. 이렇게 하면 애니메이션 시간을 변경할 때 상수 하나만 수정하면 됩니다.

## 3. 폼의 응집도 생각하기

Form을 관리할 때는 2가지의 방법으로 응집도를 관리해서, 함께 수정되어야 할 코드가 함께 수정되도록 할 수 있습니다.

### 필드 단위 응집도

필드 단위 응집은 개별 입력 요소를 독립적으로 관리하는 방식입니다.

```tsx
import { useForm } from "react-hook-form";

export function Form() {
  const { register, formState: { errors }, handleSubmit } = useForm({
    defaultValues: { name: "", email: "" }
  });

  return (
    <form onSubmit={handleSubmit((data) => console.log(data))}>
      <div>
        <input
          {...register("name", {
            validate: (value) => isEmptyStringOrNil(value) ? "이름을 입력해주세요." : ""
          })}
          placeholder="이름"
        />
        {errors.name && <p>{errors.name.message}</p>}
      </div>

      <div>
        <input
          {...register("email", {
            validate: (value) => {
              if (isEmptyStringOrNil(value)) return "이메일을 입력해주세요.";
              if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value)) {
                return "유효한 이메일 주소를 입력해주세요.";
              }
              return "";
            }
          })}
          placeholder="이메일"
        />
        {errors.email && <p>{errors.email.message}</p>}
      </div>

      <button type="submit">제출</button>
    </form>
  );
}
```

### 폼 전체 단위 응집도

폼 전체 응집은 모든 필드의 검증 로직이 폼에 종속되는 방식입니다.

```tsx
import * as z from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

const schema = z.object({
  name: z.string().min(1, "이름을 입력해주세요."),
  email: z.string().min(1, "이메일을 입력해주세요.").email("유효한 이메일 주소를 입력해주세요.")
});

export function Form() {
  const { register, formState: { errors }, handleSubmit } = useForm({
    defaultValues: { name: "", email: "" },
    resolver: zodResolver(schema)
  });

  return (
    <form onSubmit={handleSubmit((data) => console.log(data))}>
      <div>
        <input {...register("name")} placeholder="이름" />
        {errors.name && <p>{errors.name.message}</p>}
      </div>
      <div>
        <input {...register("email")} placeholder="이메일" />
        {errors.email && <p>{errors.email.message}</p>}
      </div>
      <button type="submit">제출</button>
    </form>
  );
}
```

**규칙**: 
- **필드 단위 응집도를 선택하면 좋을 때**: 독립적인 검증이 필요할 때, 재사용이 필요할 때
- **폼 전체 단위 응집도를 선택하면 좋을 때**: 단일 기능을 나타낼 때, 단계별 입력이 필요할 때, 필드 간 의존성이 있을 때

## 4. Props Drilling 지우기

Props Drilling은 부모 컴포넌트와 자식 컴포넌트 사이에 결합도가 생겼다는 것을 나타내는 명확한 표시입니다.

### 나쁜 예시

```tsx
function ItemEditModal({ open, items, recommendedItems, onConfirm, onClose }) {
  const [keyword, setKeyword] = useState("");

  return (
    <Modal open={open} onClose={onClose}>
      <ItemEditBody
        items={items}
        keyword={keyword}
        onKeywordChange={setKeyword}
        recommendedItems={recommendedItems}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    </Modal>
  );
}

function ItemEditBody({ keyword, onKeywordChange, items, recommendedItems, onConfirm, onClose }) {
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Input value={keyword} onChange={(e) => onKeywordChange(e.target.value)} />
        <Button onClick={onClose}>닫기</Button>
      </div>
      <ItemEditList keyword={keyword} items={items} recommendedItems={recommendedItems} onConfirm={onConfirm} />
    </>
  );
}
```

### 좋은 예시 (조합 패턴)

```tsx
function ItemEditModal({ open, items, recommendedItems, onConfirm, onClose }) {
  const [keyword, setKeyword] = useState("");

  return (
    <Modal open={open} onClose={onClose}>
      <ItemEditBody keyword={keyword} onKeywordChange={setKeyword} onClose={onClose}>
        <ItemEditList keyword={keyword} items={items} recommendedItems={recommendedItems} onConfirm={onConfirm} />
      </ItemEditBody>
    </Modal>
  );
}

function ItemEditBody({ children, keyword, onKeywordChange, onClose }) {
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Input value={keyword} onChange={(e) => onKeywordChange(e.target.value)} />
        <Button onClick={onClose}>닫기</Button>
      </div>
      {children}
    </>
  );
}
```

### 좋은 예시 (ContextAPI)

```tsx
function ItemEditModal({ open, onConfirm, onClose }) {
  const [keyword, setKeyword] = useState("");

  return (
    <Modal open={open} onClose={onClose}>
      <ItemEditBody keyword={keyword} onKeywordChange={setKeyword} onClose={onClose}>
        <ItemEditList keyword={keyword} onConfirm={onConfirm} />
      </ItemEditBody>
    </Modal>
  );
}

function ItemEditList({ keyword, onConfirm }) {
  const { items, recommendedItems } = useItemEditModalContext();
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Input value={keyword} onChange={(e) => onKeywordChange(e.target.value)} />
        <Button onClick={onClose}>닫기</Button>
      </div>
      {children}
    </>
  );
}
```

**규칙**: 
1. 컴포넌트는 props를 통해서 어떤 데이터를 사용할지 명확하게 표현합니다. 컴포넌트의 역할과 의도를 담고 있는 props라면 문제가 되지 않을 수 있습니다.
2. ContextAPI를 사용하기 전, `children` prop을 이용해서 컴포넌트를 전달해 depth를 줄일 수 있습니다.
3. 위 내용을 먼저 고려를 해보고 접근 방법이 모두 맞지 않을 때 최후의 방법으로 ContextAPI를 사용하세요.

## 5. 중복 코드 허용하기

개발자로서 여러 페이지나 컴포넌트에 걸친 중복 코드를 하나의 Hook이나 컴포넌트로 공통화하는 경우가 많습니다. 그렇지만, 불필요한 결합도가 생겨서, 공통 컴포넌트나 Hook을 수정함에 따라 영향을 받는 코드의 범위가 넓어져서, 오히려 수정이 어려워질 수도 있습니다.

### 나쁜 예시

```typescript
export const useOpenMaintenanceBottomSheet = () => {
  const maintenanceBottomSheet = useMaintenanceBottomSheet();
  const logger = useLogger();

  return async (maintainingInfo: TelecomMaintenanceInfo) => {
    logger.log("점검 바텀시트 열림");
    const result = await maintenanceBottomSheet.open(maintainingInfo);
    if (result) {
      logger.log("점검 바텀시트 알림받기 클릭");
    }
    closeView();
  };
};
```

이 Hook은 여러 페이지에서 반복적으로 보이는 로직이기에 공통화되었습니다. 그렇지만 앞으로 생길 수 있는 다양한 코드 변경의 가능성을 생각해볼 수 있습니다:
- 만약에 페이지마다 로깅하는 값이 달라진다면?
- 만약에 어떤 페이지에서는 점검 바텀시트를 닫더라도 화면을 닫을 필요가 없다면?
- 바텀시트에서 보여지는 텍스트나 이미지를 다르게 해야 한다면?

**규칙**: 다소 반복되어 보이는 코드일지 몰라도, 중복 코드를 허용하는 것이 좋은 방향일 수 있습니다. 페이지마다 동작이 달라질 여지가 있다면, 공통화 없이 중복 코드를 허용하는 것이 더 좋은 선택입니다.

## 6. 책임을 하나씩 관리하기

쿼리 파라미터, 상태, API 호출과 같은 로직의 종류에 따라서 함수나 컴포넌트, Hook을 나누지 마세요.

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

이 Hook은 "이 페이지에 필요한 모든 쿼리 매개변수를 관리하는 것"이라는 광범위한 책임을 가지고 있습니다. 이로 인해 페이지 내의 컴포넌트나 다른 훅들이 이 훅에 의존하게 될 수 있으며, 코드 수정을 할 때 영향 범위가 급격히 확장될 수 있습니다.

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

**규칙**: 각각의 쿼리 파라미터별로 별도의 Hook을 작성하세요. Hook이 담당하는 책임을 분리했기 때문에, 수정에 따른 영향이 갈 범위를 좁힐 수 있습니다.
