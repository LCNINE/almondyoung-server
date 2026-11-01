/**
 * 토큰 테넌트가 이 주소의 테넌트와 다를 때 미들웨어가 보내는 곳. 다시 로그인하면 같은 IdP 세션이 같은 토큰을 내주므로 로그아웃만
 * 권한다(로그아웃은 이 주소의 auth-web 세션까지 끝낸다). 두 셸 모두에 뜨므로 브랜드 문구가 없다.
 */
export default function WrongAccountPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm space-y-4 rounded-lg border bg-white p-6 text-center">
        <h1 className="text-lg font-semibold text-gray-900">이 주소에서 쓸 수 없는 계정입니다</h1>
        <p className="text-sm text-gray-600">로그아웃한 뒤 이 주소의 계정으로 다시 로그인하세요.</p>
        <a
          href="/api/auth/signout"
          className="inline-block w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          로그아웃
        </a>
      </div>
    </div>
  );
}
