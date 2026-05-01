import React from "react"
//   /store/customers/me/addresses 메두사 배송지 등록 api
// --- 아이콘 Placeholder (lucide-react 등 라이브러리로 대체) ---
const BackIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="15 18 9 12 15 6"></polyline>
  </svg>
)
const UserIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
    <circle cx="12" cy="7" r="4"></circle>
  </svg>
)
const LocationIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
    <circle cx="12" cy="10" r="3"></circle>
  </svg>
)
const PhoneIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
  </svg>
)
const SearchIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="8"></circle>
    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
  </svg>
)
const MessageIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
  </svg>
)
const ChevronRightIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="9 18 15 12 9 6"></polyline>
  </svg>
)

function AddAddressPage() {
  return (
    <main className="min-h-screen w-full bg-white font-sans">
      {/* --- 페이지 헤더 --- */}
      <header className="flex items-center border-b p-4">
        <button aria-label="뒤로 가기">
          <BackIcon />
        </button>
        <div className="flex-grow text-center">
          <h1 className="text-lg font-bold">주문 / 결제</h1>
        </div>
        <div className="w-6"></div> {/* 오른쪽 여백 맞추기용 */}
      </header>

      {/* --- 메인 콘텐츠 (폼) --- */}
      <div className="p-4">
        <h2 className="text-xl font-bold">배송지 추가</h2>

        <form className="mt-6 space-y-3">
          {/* 받는 사람 */}
          <div className="flex items-center gap-3 rounded-md border border-gray-300 p-3">
            <label htmlFor="recipient-name" className="text-gray-400">
              <UserIcon />
            </label>
            <input
              type="text"
              id="recipient-name"
              placeholder="받는 사람"
              className="w-full bg-transparent text-base placeholder-gray-400 focus:outline-none"
            />
          </div>

          {/* 우편번호 찾기 */}
          <div className="flex items-center rounded-md border border-gray-300">
            <div className="flex flex-grow items-center gap-3 p-3">
              <span className="text-gray-400">
                <LocationIcon />
              </span>
              <span className="text-base font-semibold text-blue-500">
                우편번호 찾기
              </span>
            </div>
            <button type="button" aria-label="우편번호 검색" className="p-3">
              <SearchIcon />
            </button>
          </div>

          {/* 휴대폰 번호 */}
          <div className="flex items-center rounded-md border border-gray-300">
            <div className="flex flex-grow items-center gap-3 p-3">
              <label htmlFor="phone-number" className="text-gray-400">
                <PhoneIcon />
              </label>
              <input
                type="tel"
                id="phone-number"
                placeholder="휴대폰 번호"
                className="w-full bg-transparent text-base placeholder-gray-400 focus:outline-none"
              />
            </div>
            <button
              type="button"
              aria-label="추가"
              className="border-l border-gray-300 p-3 text-xl font-semibold"
            >
              +
            </button>
          </div>

          {/* 배송 정보 선택 */}
          <div className="mt-4 divide-y divide-gray-200 rounded-md border border-gray-300">
            <button
              type="button"
              className="flex w-full items-center justify-between p-4 text-left"
            >
              <div className="flex items-center gap-3">
                <span className="text-gray-400">
                  <MessageIcon />
                </span>
                <span className="text-base text-blue-500">
                  일반배송 정보를 선택해 주세요.
                </span>
              </div>
              <span className="text-gray-400">
                <ChevronRightIcon />
              </span>
            </button>
            <button
              type="button"
              className="flex w-full items-center justify-between p-4 text-left"
            >
              <div className="flex items-center gap-3">
                <span className="text-gray-400">
                  <MessageIcon />
                </span>
                <span className="text-base text-blue-500">
                  새벽배송 정보를 선택해 주세요.
                </span>
              </div>
              <span className="text-gray-400">
                <ChevronRightIcon />
              </span>
            </button>
          </div>

          {/* 기본 배송지 선택 */}
          <div className="pt-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-5 w-5 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
              />
              <span className="text-base text-gray-700">
                기본 배송지로 선택
              </span>
            </label>
          </div>

          {/* 저장 버튼 */}
          <div className="pt-8">
            <button
              type="submit"
              className="w-full rounded-md bg-blue-500 py-4 text-lg font-bold text-white"
            >
              저장
            </button>
          </div>
        </form>
      </div>
    </main>
  )
}

export default AddAddressPage
