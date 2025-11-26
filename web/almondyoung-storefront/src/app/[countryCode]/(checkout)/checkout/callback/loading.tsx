export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f8f8f8]">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-lg">
        <div className="flex flex-col items-center">
          {/* Loading Spinner */}
          <div className="mb-4 h-16 w-16 animate-spin rounded-full border-b-2 border-[#F29219]"></div>

          <h2 className="mb-2 text-2xl font-bold text-gray-900">
            결제 처리 중
          </h2>
          <p className="text-center text-gray-600">결제를 처리 중입니다...</p>

          <div className="mt-6 text-center text-sm text-gray-500">
            잠시만 기다려주세요.
            <br />
            페이지를 닫거나 새로고침하지 마세요.
          </div>
        </div>
      </div>
    </div>
  )
}
