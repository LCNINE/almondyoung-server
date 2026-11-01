/**
 * 모르는 주소·준비/정지 테넌트 주소의 화면. 브랜드가 없다 — 어느 회사의 이름도, 로그인 폼도 그리지 않는다.
 */
export function SiteUnavailable() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-3 px-6 py-12">
      <h1 className="text-xl font-semibold">
        이 주소에서는 로그인할 수 없어요
      </h1>
      <p className="text-sm text-muted-foreground">
        주소를 다시 확인해 주세요. 계속되면 관리자에게 문의해 주세요.
      </p>
    </main>
  )
}
