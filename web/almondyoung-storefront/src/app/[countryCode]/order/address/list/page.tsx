import React from "react"

// --- 아이콘 Placeholder ---
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
type AddressCardProps = {
  addressInfo: {
    name: string
    isDefault: boolean
    tags: string[]
    address: string
    phone: string
    instructions: string
  }
}
// --- 각 주소 카드를 위한 하위 컴포넌트 ---
// isDefault와 같은 prop을 받아 테두리 색상을 동적으로 변경합니다.
const AddressCard = ({ addressInfo }: AddressCardProps) => {
  const { name, isDefault, tags, address, phone, instructions } = addressInfo

  // 태그 스타일에 대한 객체
  const tagStyles = {
    default: "bg-green-100 text-green-700",
    rocket: "bg-blue-100 text-blue-700",
  }

  return (
    <li
      className={`rounded-lg border-2 ${isDefault ? "border-blue-500" : "border-gray-200"} p-4`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-bold">{name}</h3>
        {isDefault && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tagStyles.default}`}
          >
            기본배송지
          </span>
        )}
        {tags.map((tag) => (
          <span
            key={tag}
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tagStyles.rocket}`}
          >
            {tag}
          </span>
        ))}
      </div>
      <div className="mt-3 space-y-1 text-base text-gray-700">
        <p>{address}</p>
        <p>{phone}</p>
        <p className="text-gray-500">{instructions}</p>
      </div>
      <div className="mt-4 flex items-center justify-between gap-2">
        <button className="flex-1 rounded-md border border-gray-300 py-2.5 text-sm font-semibold text-gray-700">
          수정
        </button>
        <button className="flex-1 rounded-md bg-blue-500 py-2.5 text-sm font-bold text-white">
          선택
        </button>
      </div>
    </li>
  )
}

function SelectAddressPage() {
  // 실제 앱에서는 API로부터 이 주소 목록 데이터를 받아옵니다.
  const addresses = [
    {
      name: "이연정",
      isDefault: true,
      tags: ["로켓프레시 가능", "로켓와우 가능"],
      address: "서울특별시 강북구 도봉로95길 35, 1층",
      phone: "010-9921-5468",
      instructions: "일반 : 문 앞 (12***) / 새벽 : 택배함 (없음)",
    },
    {
      name: "이연정",
      isDefault: false,
      tags: ["로켓와우 가능"],
      address: "경상남도 거제시 옥포대첩로3길 23, 고은빌라 나동 305호",
      phone: "010-9921-5468",
      instructions: "문 앞",
    },
    {
      name: "신동수",
      isDefault: false,
      tags: ["로켓프레시 가능", "로켓와우 가능"],
      address:
        "경기도 의정부시 낙양동 754 양지마을8단지, 810동 503호(낙양동, 양지마을8단지)",
      phone: "010-3893-0129",
      instructions: "일반 : 문 앞 / 새벽 : 문 앞 (경비실 호출)",
    },
  ]

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

      {/* --- 메인 콘텐츠 (주소 목록) --- */}
      <div className="p-4">
        <h2 className="text-xl font-bold">배송지 선택</h2>

        {/* 주소 목록은 순서가 없는 리스트(ul)로 마크업하는 것이 시맨틱합니다. */}
        <ul className="mt-4 space-y-3">
          {addresses.map((addr, index) => (
            <AddressCard key={index} addressInfo={addr} />
          ))}
        </ul>
      </div>
    </main>
  )
}

export default SelectAddressPage
