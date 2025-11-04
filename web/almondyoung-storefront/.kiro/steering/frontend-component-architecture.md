---
inclusion: false
---

# 프론트엔드 코드 작성 규칙: 컴포넌트 및 아키텍처

이 문서는 프론트엔드 컴포넌트와 아키텍처를 설계할 때 따라야 할 규칙을 정의합니다.

## 1. 구현 상세를 컴포넌트로 추상화하기

한 사람이 코드를 읽을 때 동시에 고려할 수 있는 총 맥락의 숫자는 제한되어 있습니다. 내 코드를 읽는 사람들이 코드를 쉽게 읽을 수 있도록 하기 위해서 불필요한 맥락을 추상화할 수 있습니다.

### 나쁜 예시

```tsx
function FriendInvitation() {
  const { data } = useQuery(/* 생략.. */);

  const handleClick = async () => {
    const canInvite = await overlay.openAsync(({ isOpen, close }) => (
      <ConfirmDialog
        title={`${data.name}님에게 공유해요`}
        cancelButton={<ConfirmDialog.CancelButton onClick={() => close(false)}>닫기</ConfirmDialog.CancelButton>}
        confirmButton={<ConfirmDialog.ConfirmButton onClick={() => close(true)}>확인</ConfirmDialog.ConfirmButton>}
        /* 중략 */
      />
    ));

    if (canInvite) await sendPush();
  };

  return (
    <>
      <Button onClick={handleClick}>초대하기</Button>
      {/* UI를 위한 JSX 마크업... */}
    </>
  );
}
```

`<FriendInvitation />` 컴포넌트는 실제로 사용자에게 동의를 받을 때 사용하는 자세한 로직까지 하나의 컴포넌트에 가지고 있습니다. 그래서 코드를 읽을 때 따라가야 할 맥락이 많아서 읽기 어렵습니다.

### 좋은 예시

```tsx
export function FriendInvitation() {
  const { data } = useQuery(/* 생략.. */);

  return (
    <>
      <InviteButton name={data.name} />
      {/* UI를 위한 JSX 마크업 */}
    </>
  );
}

function InviteButton({ name }) {
  return (
    <Button
      onClick={async () => {
        const canInvite = await overlay.openAsync(({ isOpen, close }) => (
          <ConfirmDialog
            title={`${name}님에게 공유해요`}
            cancelButton={<ConfirmDialog.CancelButton onClick={() => close(false)}>닫기</ConfirmDialog.CancelButton>}
            confirmButton={<ConfirmDialog.ConfirmButton onClick={() => close(true)}>확인</ConfirmDialog.ConfirmButton>}
            /* 중략 */
          />
        ));

        if (canInvite) await sendPush();
      }}
    >
      초대하기
    </Button>
  );
}
```

**규칙**: 사용자에게 동의를 받는 로직과 버튼을 별도의 컴포넌트로 추상화하세요. 이렇게 하면 한 번에 인지해야 하는 내용을 적게 유지해서 가독성을 높일 수 있습니다.

## 2. 인증 로직을 Wrapper 컴포넌트나 HOC로 분리하기

사용자가 로그인되었는지 확인하고 이동하는 로직을 HOC(Higher-Order Component)나 Wrapper 컴포넌트로 분리하여, 코드를 읽는 사람이 한 번에 알아야 하는 맥락을 줄이세요.

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
    if (status === "LOGGED_IN") location.href = "/home";
  }, [status]);
  return status !== "LOGGED_IN" ? children : null;
}

function LoginStartPage() {
  /* ... 로그인 관련 로직 ... */
  return <>{/* ... 로그인 관련 컴포넌트 ... */}</>;
}
```

### 좋은 예시 (HOC)

```tsx
function LoginStartPage() {
  /* ... 로그인 관련 로직 ... */
  return <>{/* ... 로그인 관련 컴포넌트 ... */}</>;
}

export default withAuthGuard(LoginStartPage);

function withAuthGuard(WrappedComponent) {
  return function AuthGuard(props) {
    const status = useCheckLoginStatus();
    useEffect(() => {
      if (status === "LOGGED_IN") location.href = "/home";
    }, [status]);
    return status !== "LOGGED_IN" ? <WrappedComponent {...props} /> : null;
  };
}
```

**규칙**: 로그인 확인 로직을 Wrapper 컴포넌트나 HOC로 분리하여 관심사를 분리하고, 분리된 컴포넌트 안에 있는 로직끼리 참조를 막음으로써, 코드 간의 불필요한 의존 관계가 생겨서 복잡해지는 것을 막을 수 있습니다.

## 3. 같이 실행되지 않는 코드를 별도 컴포넌트로 분리하기

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

`<SubmitButton />` 컴포넌트에서는 사용자가 가질 수 있는 2가지의 권한 상태를 하나의 컴포넌트 안에서 한 번에 처리하고 있습니다. 그래서 코드를 읽는 사람이 한 번에 고려해야 하는 맥락이 많습니다.

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

**규칙**: 
- `<SubmitButton />` 코드 곳곳에 있던 분기가 단 하나로 합쳐지면서, 분기가 줄어듭니다.
- `<ViewerSubmitButton />`과 `<AdminSubmitButton />`에서는 하나의 분기만 관리하기 때문에, 코드를 읽는 사람이 한 번에 고려해야 할 맥락이 적습니다.

## 4. 조합(Composition) 패턴으로 Props Drilling 해결하기

조합 패턴을 사용하면 부모 컴포넌트가 자식 컴포넌트에 Props를 일일이 전달해야 하는 Props Drilling 문제를 해결할 수 있습니다.

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

### 좋은 예시

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

**규칙**: `children`을 사용해 필요한 컴포넌트를 부모에서 작성하도록 하면 불필요한 Props Drilling을 줄일 수 있습니다. 조합 패턴은 불필요한 중간 추상화를 제거하여 개발자가 각 컴포넌트의 역할과 의도를 보다 명확하게 이해할 수 있습니다.

## 5. ContextAPI는 최후의 수단으로 사용하기

Context API를 활용하면, 데이터의 흐름을 간소화하고 계층 구조 전체에 쉽게 공유할 수 있습니다.

### 좋은 예시

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

**규칙**: ContextAPI를 사용하면 매우 쉽게 Props Drilling을 해결할 수 있지만, Props Drilling이 되는 모든 값을 ContextAPI로 관리해야 하는 것은 아닙니다.

1. 컴포넌트는 props를 통해서 어떤 데이터를 사용할지 명확하게 표현합니다. 컴포넌트의 역할과 의도를 담고 있는 props라면 문제가 되지 않을 수 있습니다.

2. ContextAPI를 사용하기 전, `children` prop을 이용해서 컴포넌트를 전달해 depth를 줄일 수 있습니다. 데이터를 사용하지 않는 단순히 값을 전달하기 위한 용도의 컴포넌트는 props가 컴포넌트의 역할과 의도를 나타내지 않을 수 있습니다. 이러한 경우에 조합(Composition) 패턴을 사용한다면 불필요한 depth를 줄일 수 있습니다.

위 내용을 먼저 고려를 해보고 접근 방법이 모두 맞지 않을 때 최후의 방법으로 ContextAPI를 사용해야 합니다.

## 6. 권한에 따른 UI 분기 처리하기

권한에 따라 다른 UI를 보여줄 때는 조건을 요구사항 그대로 코드에 드러내거나, 조건을 한눈에 볼 수 있는 객체로 만들어서 시점 이동을 줄이세요.

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
  return { canInvite: policy.includes("invite"), canView: policy.includes("view") };
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

**규칙**: 권한에 따른 조건을 요구사항 그대로 코드에 드러내거나, 조건을 한눈에 볼 수 있는 객체로 만들어서 코드를 위에서 아래로만 읽으면 한눈에 권한을 다루는 로직을 파악할 수 있도록 하세요.

## 7. 디렉토리 구조는 도메인 중심으로 구성하기

함께 수정되는 코드 파일을 하나의 디렉토리 아래에 두면, 코드 사이의 의존 관계를 파악하기 쉽습니다.

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

**규칙**: 
- 함께 수정되는 코드 파일끼리 하나의 디렉토리를 이루도록 구조를 개선하세요.
- 한 도메인의 하위 코드에서 다른 도메인의 소스 코드를 참조한다면 잘못된 파일을 참조하고 있다는 것을 쉽게 인지할 수 있게 됩니다.
- 특정 기능과 관련된 코드를 삭제할 때 한 디렉토리 전체를 삭제하면 깔끔하게 모든 코드가 삭제되므로, 프로젝트 내부에 더 이상 사용되지 않는 코드가 없도록 할 수 있습니다.
