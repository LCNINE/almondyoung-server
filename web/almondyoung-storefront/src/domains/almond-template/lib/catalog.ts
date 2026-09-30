export type PrintKind =
  | "pet"
  | "mini"
  | "card"
  | "window"
  | "menu"
  | "diploma"
  | "nail"

export const PRINT_PRODUCTS: Record<
  string,
  { kind: PrintKind; title: string }
> = {
  "6c2b7437-7c72-4685-a72c-0cd18f9d7bfb": {
    kind: "card",
    title: "반영구 시술 후 주의사항 500매",
  },
  "803ec5ae-df99-4065-9af1-5fb096e105e7": {
    kind: "card",
    title: "속눈썹 연장 시술 후 주의사항 500매",
  },
  "f49c6f16-1522-42b9-a600-e0acf83fdf89": {
    kind: "card",
    title: "속눈썹펌 시술 후 주의사항 500매",
  },
  "e81350cf-d972-4db7-9e54-ba8db80bdcb6": {
    kind: "card",
    title: "스킨플래닝 시술 후 주의사항 500매",
  },
  "7811a1a6-9ab8-470d-9ac1-5c089fed6b68": {
    kind: "card",
    title: "왁싱 시술 후 주의사항 500매",
  },
  "09a0e12a-18d1-452a-a9bc-9d133d1c34c6": {
    kind: "card",
    title: "패디플래닝 시술 후 주의사항 500매",
  },
  "c5cea112-9145-4206-bb83-d0ff68c9bd69": {
    kind: "menu",
    title: "뷰티샵 전용 메뉴판 12종 (수정가능)",
  },
  "2f0bbc8d-a82b-4993-89e7-01853e143f7d": {
    kind: "menu",
    title: "메뉴 고급 속지 디자인 제작",
  },
  "ff7a0f71-9d6c-4d10-9b40-51661614837b": {
    kind: "pet",
    title: "SMP 두피문신 입간판",
  },
  "80418c4c-146e-4b2f-be9b-2047455e6fe5": {
    kind: "pet",
    title: "네일 여름 이벤트 입간판",
  },
  "affd4ef8-e9f3-400a-b27c-0ae0a77e77ce": {
    kind: "pet",
    title: "뉴 민트 스킨플래닝 입간판",
  },
  "3ccc12bf-0804-46fa-82f2-5bc2dea43493": {
    kind: "pet",
    title: "뉴 오렌지 스킨플래닝 입간판",
  },
  "61639dee-8f61-4325-8784-0bc348ee0d16": {
    kind: "pet",
    title: "리프팅 배너 입간",
  },
  "578ec969-1015-4ac1-8db7-14059f10b498": {
    kind: "pet",
    title: "뷰티샵 전용 입간판 1",
  },
  "a215c7ef-dbaf-4840-9596-08bd8cf57eb0": {
    kind: "pet",
    title: "뷰티샵 전용 입간판 2",
  },
  "a4b0d345-c3dc-4ab0-95e5-812debc148b7": {
    kind: "pet",
    title: "속눈썹 펌 입간판 1",
  },
  "b63c487d-44dd-4968-8fbe-47c0ee553c2d": {
    kind: "pet",
    title: "속눈썹 펌 입간판 2",
  },
  "c93dd2bc-6398-4ff7-aa5d-dff41608de75": {
    kind: "pet",
    title: "아쿠아필 입간판",
  },
  "6df075ae-cb04-49f3-81b8-11780377d99c": {
    kind: "pet",
    title: "에스테틱 여름 이벤트 입간판",
  },
  "d65941e6-32d0-4c7d-8efc-e58b74f5df86": {
    kind: "pet",
    title: "여름 이벤트 입간판",
  },
  "6d02f433-4f01-4ecd-90cb-8807e6ce4502": {
    kind: "pet",
    title: "왁싱 금액 입간판",
  },
  "0a66cf90-490d-405b-a978-cd863ff8fe63": {
    kind: "pet",
    title: "왁싱 여름 이벤트 입간판",
  },
  "cb9c82ad-8a6d-4a31-b1b4-0f49b62aa2b7": {
    kind: "pet",
    title: "패디플래닝 큰배너 블루",
  },
  "d916f1f4-2bbe-4f3b-b3c2-dba8e5733c9d": {
    kind: "pet",
    title: "패디플래닝 큰배너 옐로우",
  },
  "67630b10-10b6-4a23-bea0-b3a65af73870": {
    kind: "pet",
    title: "패디플래닝 큰배너 핑크",
  },
  "fc226449-2d02-4c6a-99ef-2c0f0a52481a": {
    kind: "pet",
    title: "핑크 스킨플래닝 입간판",
  },
  "6cefacec-4815-4731-baa1-6e76bcedb704": {
    kind: "pet",
    title: "하늘 스킨플래닝 입간판",
  },
  "3ee7a9c6-8575-4b61-998d-a6128f32fa61": {
    kind: "pet",
    title: "하이푸 리프팅 입간판",
  },
  "1154e017-981b-47de-b672-7a574124831a": {
    kind: "pet",
    title: "헤어 여름 이벤트 입간판",
  },
  "148ea63b-4741-417a-90dd-ccd5c81fc587": {
    kind: "pet",
    title: "호박필 피부 큰배너 입간판",
  },
  "8caf335b-9118-42d9-a8a5-6999c46be563": {
    kind: "window",
    title: "가을 이벤트 유리창 부착용 배너",
  },
  "81359009-c647-45f7-b05e-72191c7ca288": {
    kind: "window",
    title: "네일샵 여름이벤트 플랜카드",
  },
  "6d79d409-e770-4885-9a2f-e5e683d374a6": {
    kind: "window",
    title: "스킨플래닝 유리창 부착용 현수막",
  },
  "6d45de9c-b8c5-4034-a565-8efe67537166": {
    kind: "mini",
    title: "SMP 두피문신 미니배너",
  },
  "96c094bb-d52d-47d9-a73b-ae7b157c2c1b": {
    kind: "mini",
    title: "SNS 이벤트 미니배너",
  },
  "83a798d2-18a7-4886-a4da-d2612b570700": {
    kind: "mini",
    title: "네이버예약 미니배너",
  },
  "67a66e65-1de3-449f-a609-5e5e30e32e43": {
    kind: "mini",
    title: "리프팅 미니 배너 테이블 거치대",
  },
  "43471f19-3d9f-4316-bfb8-0e7eebd8e771": {
    kind: "window",
    title: "봄이벤트 미니배너 (실제로는 정사각 창문 현수막)",
  },
  "63c0f5de-8105-4126-b4b3-12171dcbbfde": {
    kind: "mini",
    title: "블랙틴팅 속눈썹펌 미니배너",
  },
  "22de81c1-6cf9-4d53-b3a6-37e70f5b75be": {
    kind: "mini",
    title: "속눈썹 영양제 미니배너",
  },
  "3315e9ae-f74b-4ff0-9950-8c00e4bd3d2c": {
    kind: "mini",
    title: "속눈썹펌 미니배너",
  },
  "063f4d30-59c3-4651-817d-b381d150ad47": {
    kind: "mini",
    title: "스킨플래닝 테이블 미니 배너",
  },
  "06a47a6a-a9f9-4beb-a582-a46e16ecd268": {
    kind: "mini",
    title: "시술후기 이벤트 미니배너",
  },
  "def34476-97e1-422b-9dca-cab64c242124": {
    kind: "mini",
    title: "예비맘 임산부 미니배너",
  },
  "758bd1b8-8082-4ffa-9124-9572c06ee5f3": {
    kind: "mini",
    title: "와이파이 미니배너",
  },
  "6e3fc699-85e2-43dd-be57-a0c30543b546": {
    kind: "mini",
    title: "패디플래닝 미니 배너 2",
  },
  "f4ce1cc1-4e11-4cde-b95a-8eef3e35f827": {
    kind: "mini",
    title: "패디플래닝 미니배너 1",
  },
  "9e7c17e5-849b-4c60-8a64-9fca5e0c7b29": {
    kind: "diploma",
    title: "뷰티 아카데미 디플로마 1:1 맞춤제작",
  },
  "6bf3e0b0-f2c4-481d-957e-92d3ff7d8312": {
    kind: "diploma",
    title: "아카데미 임명장 표창장 위촉장 디플로마",
  },
  "d8cc694d-2257-4c5a-91f4-01579edd68d2": {
    kind: "nail",
    title: "네일팁 종이 제작",
  },
}

export const PRINT_SPECS: Record<
  PrintKind,
  {
    label: string
    sizes: [number, number][]
    safetyMm: number
    bleedMm: number
    fileScale: number
    minImageDpi: number
    note: string
  }
> = {
  pet: {
    label: "PET 입간판·X배너",
    sizes: [[600, 1800]],
    safetyMm: 20,
    bleedMm: 0,
    fileScale: 1,
    minImageDpi: 300,
    note: "공식 PET배너 칼선은 실물 크기(1:1). 네 모서리 40×40mm 타공, 안전선은 아몬드영이 정한 보수적 20mm입니다.",
  },
  mini: {
    label: "테이블 미니배너",
    sizes: [
      [150, 300],
      [180, 420],
    ],
    safetyMm: 15,
    bleedMm: 0,
    fileScale: 1,
    minImageDpi: 350,
    note: "공식 미니배너 칼선은 실물 크기(1:1). 네 모서리 타공 표시와 사방 15mm 안쪽의 중요 문구 배치를 확인하세요. 거치대 부자재는 별도입니다.",
  },
  card: {
    label: "시술 후 주의사항 카드",
    sizes: [[90, 50]],
    safetyMm: 1.5,
    bleedMm: 1.5,
    fileScale: 1,
    minImageDpi: 300,
    note: "이지템플릿 명함 90×50mm와 규격 대조. 스노우지 250g·500매, 양면은 앞/뒷면 작업.",
  },
  window: {
    label: "유리창 부착 현수막",
    sizes: [
      [600, 600],
      [800, 800],
      [1000, 1000],
    ],
    safetyMm: 20,
    bleedMm: 0,
    fileScale: 0.1,
    minImageDpi: 700,
    note: "일반현수막은 실물의 1/10 크기로 파일을 작업합니다. 정사각 600/800/1000mm의 안전선 20mm는 임시값이며 타공·큐방 위치와 함께 칼선 및 API 접수 확인이 필요합니다.",
  },
  menu: {
    label: "메뉴판·가격표",
    sizes: [
      [210, 297],
      [297, 420],
      [148, 210],
    ],
    safetyMm: 10,
    bleedMm: 3,
    fileScale: 1,
    minImageDpi: 300,
    note: "포맥스 3t와 코팅 포스터는 생산 품목이 다릅니다. 이지템플릿 규격·칼선은 미확인이고 안전선 10mm는 임시값입니다.",
  },
  diploma: {
    label: "디플로마·수료증",
    sizes: [[210, 297]],
    safetyMm: 10,
    bleedMm: 3,
    fileScale: 1,
    minImageDpi: 300,
    note: "금박용지·케이스에 대응하는 이지템플릿 상품·칼선은 미확인이고 안전선 10mm는 임시값입니다.",
  },
  nail: {
    label: "네일팁 종이",
    sizes: [[90, 90]],
    safetyMm: 1.5,
    bleedMm: 1.5,
    fileScale: 1,
    minImageDpi: 300,
    note: "90×90mm는 이지템플릿 명함의 기본 규격에 없습니다. 안전선 1.5mm는 임시값이며 비규격·용지·수량을 확인해야 합니다.",
  },
}

export function sizeFromOption(
  kind: PrintKind,
  label: string
): [number, number] | undefined {
  const value = label.replace(/\s/g, "").replace(/[×X]/g, "x").toLowerCase()
  return PRINT_SPECS[kind].sizes.find(
    ([w, h]) =>
      value.includes(`${w}x${h}`) || value.includes(`${w / 10}x${h / 10}`)
  )
}
