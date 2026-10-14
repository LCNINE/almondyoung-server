import {
  Clipboard,
  Copy,
  Eye,
  FolderOpen,
  Frame,
  Hand,
  ImageIcon,
  Layers,
  LayoutTemplate,
  Minus,
  PaintBucket,
  QrCode,
  Redo2,
  Save,
  Scissors,
  Search,
  Shapes,
  Smile,
  Trash2,
  Type,
  Undo2,
  type LucideIcon,
} from "lucide-react"
import type { ReactNode } from "react"
import type { AlmondEditor } from "../../../hooks/use-almond-editor"

type Item = [LucideIcon, string, ReactNode]

const MENU: Item[] = [
  [Eye, "미리보기", "최종 데이터를 미리 볼 수 있습니다."],
  [
    FolderOpen,
    "불러오기",
    "저장한 디자인을 불러옵니다. 같은 상품·크기의 디자인만 열 수 있습니다.",
  ],
  [
    Save,
    "저장",
    "작업 중인 디자인을 저장해 언제든지 이어서 편집할 수 있습니다. 마이페이지 「내 디자인」에서도 볼 수 있습니다.",
  ],
  [
    Type,
    "텍스트",
    "새 텍스트를 추가합니다. 텍스트를 더블클릭하면 그 자리에서 문구를 고칩니다.",
  ],
  [
    ImageIcon,
    "이미지",
    "내 PC 이미지를 불러옵니다. PNG·JPG·WebP 파일당 4MB까지 올릴 수 있습니다.",
  ],
  [
    PaintBucket,
    "배경색",
    "앞면·뒷면 배경을 색 또는 이미지로 바꿉니다. 배경 이미지는 작업 크기와 같은 비율을 쓰세요.",
  ],
  [LayoutTemplate, "템플릿", "다양한 무료 템플릿을 미리 보고 적용합니다."],
  [
    Layers,
    "레이어",
    "디자인의 모든 객체가 보입니다. 선택·숨기기·잠금·순서 변경을 할 수 있습니다.",
  ],
  [Shapes, "도형", "다양한 무료 도형을 추가합니다."],
  [Smile, "클립아트", "다양한 주제의 무료 클립아트를 추가합니다."],
  [Frame, "모양틀", "사진을 넣을 수 있는 프레임입니다."],
  [
    QrCode,
    "QR코드",
    "명함 정보나 웹주소로 QR코드를 만듭니다. 주문 전에 꼭 스캔해 확인하세요.",
  ],
]

const SHORTCUTS: Item[] = [
  [Undo2, "이전 [ Ctrl + Z ]", "이전 단계로 돌아갑니다."],
  [Redo2, "이후 [ Ctrl + Y / Ctrl + Shift + Z ]", "이후 단계로 돌아갑니다."],
  [Scissors, "잘라내기 [ Ctrl + X ]", "텍스트·이미지 등을 잘라냅니다."],
  [Copy, "복사 [ Ctrl + C / Ctrl + 드래그 ]", "텍스트·이미지 등을 복사합니다."],
  [Clipboard, "붙여넣기 [ Ctrl + V ]", "텍스트·이미지 등을 붙여 넣습니다."],
  [Hand, "화면 이동 [ 스페이스바 + 드래그 ]", "확대한 편집 화면을 움직입니다."],
  [Search, "확대/축소 [ Alt + 마우스 휠 ]", "편집 화면을 확대·축소합니다."],
  [Trash2, "삭제 [ Delete ]", "선택한 객체를 삭제합니다."],
  [Save, "저장 [ Ctrl + S ]", "저장한 디자인이면 바로 덮어씁니다."],
  [Type, "방향키 / Shift + 방향키", "선택한 객체를 조금씩 / 크게 움직입니다."],
]

const TABS = [
  ["editing", "편집기능"],
  ["shortcuts", "단축키"],
  ["image", "이미지"],
  ["print", "작업유의사항"],
] as const

function List({ items }: { items: Item[] }) {
  return (
    <ul className="space-y-4">
      {items.map(([Icon, title, body]) => (
        <li key={title} className="flex gap-3">
          <Icon size={20} className="mt-0.5 shrink-0 text-[#555d6d]" />
          <div>
            <strong className="block text-sm text-[#1a1c20]">{title}</strong>
            <p className="text-[13px] leading-5 text-[#555d6d]">- {body}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-7">
      <h3 className="mb-3 border-b border-[#1a1c20] pb-2 text-sm font-bold text-[#1a1c20]">
        {title}
      </h3>
      <div className="space-y-2 text-[13px] leading-5 text-[#555d6d]">
        {children}
      </div>
    </section>
  )
}

export function HelpDialog({ editor }: { editor: AlmondEditor }) {
  const { setHelpOpen, helpTab, setHelpTab, spec } = editor
  return (
    <aside
      aria-label="편집 도움말"
      className="absolute top-[72px] right-0 bottom-12 z-30 flex w-[400px] max-w-[90vw] flex-col border border-[#1a1c20] bg-white shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
    >
      <div className="relative flex h-11 shrink-0 items-center justify-center border-b">
        <h2 className="text-sm font-semibold">도움말</h2>
        <button
          aria-label="도움말 닫기"
          className="absolute right-2 flex size-8 items-center justify-center rounded hover:bg-slate-100"
          onClick={() => setHelpOpen(false)}
        >
          <Minus size={18} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="mb-5 flex flex-wrap gap-1.5">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              aria-pressed={helpTab === id}
              className={`rounded-full px-3 py-1.5 text-xs ${helpTab === id ? "bg-[#1a1c20] text-white" : "bg-[#f3f4f5] text-[#1a1c20]"}`}
              onClick={() => setHelpTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {helpTab === "editing" ? (
          <Section title="메뉴별 기능">
            <List items={MENU} />
          </Section>
        ) : helpTab === "shortcuts" ? (
          <Section title="단축키">
            <List items={SHORTCUTS} />
            <p className="pt-2">Mac 에서는 Ctrl 대신 ⌘ 를 누릅니다.</p>
          </Section>
        ) : helpTab === "image" ? (
          <>
            <Section title="이미지 해상도">
              <p>
                - 이 상품({spec.label})은 {spec.minImageDpi}dpi 이상의 고해상도
                이미지를 권장합니다.
                {spec.fileScale !== 1 &&
                  ` 인쇄 파일은 실물의 1/${Math.round(1 / spec.fileScale)} 크기로 만들어지며 해상도는 그 기준입니다.`}
              </p>
              <p>
                - 해상도가 낮은 이미지는 캔버스에 「⚠ 인쇄 비권장」으로
                표시되고, 그대로는 인쇄 파일 확인을 통과할 수 없습니다.
              </p>
              <p>
                - 해상도가 낮은 이미지를 억지로 키우면 흐리게 인쇄됩니다. 원본
                사진을 쓰세요.
              </p>
            </Section>
            <Section title="RGB / CMYK 색상의 차이">
              <p>
                - RGB 는 모니터·휴대폰 화면의 빛의 색, CMYK 는
                청록·자홍·노랑·검정 잉크를 섞는 인쇄 색입니다.
              </p>
              <p>
                - 인쇄 파일은 CMYK 로 변환되어, 화면보다 조금 어둡고 진하게
                인쇄될 수 있습니다. 형광색·아주 밝은 색은 특히 차이가 큽니다.
              </p>
            </Section>
          </>
        ) : (
          <>
            <Section title="재단 / 작업">
              <p>
                <strong className="text-[#1a1c20]">재단선</strong> 실제 상품
                크기입니다.
                {spec.bleedMm > 0 &&
                  ` 인쇄 파일은 사방 ${spec.bleedMm}mm 여유를 더해 만들어지고, 가장자리에 닿은 배경·사진·사각형은 그 여유까지 자동으로 채워집니다.`}
              </p>
              <p>
                <strong className="text-[#1a1c20]">안전선</strong> 재단 시
                밀림이 생길 수 있으니 글자·QR코드 같은 중요한 내용은 안전선 (
                {spec.safetyMm}mm) 안에 두세요.
              </p>
            </Section>
            <Section title="작업 / 주문 시 유의사항">
              <p>
                - 글자는 인쇄 파일에서 외곽선(아웃라인)으로 바뀌어 접수됩니다.
              </p>
              <p>- 저해상도 이미지는 인쇄 품질이 떨어집니다.</p>
              <p>
                - 같은 데이터라도 인쇄할 때마다 색상 차이가 생길 수 있습니다.
              </p>
              <p>
                - 편집 화면과 실제 인쇄물은 다를 수 있으니 미리보기로 꼼꼼히
                확인하세요. 확인하지 않고 주문한 경우 재작업·환불이 어렵습니다.
              </p>
              <p>
                - 주문 제작 상품이라 단순 변심에 의한 교환·환불이 불가합니다.
              </p>
              <p>
                - 인쇄 제작이 시작되면 주문을 취소할 수 없습니다. 같은 주문의
                다른 상품은 따로 취소할 수 있습니다.
              </p>
              <p>
                - 인쇄 불량은 받으신 날부터 5일 안에 사진과 함께 고객센터로
                문의해 주세요. 확인되면 재제작해 드리며, 받으신 인쇄물은 모두
                돌려보내 주셔야 합니다.
              </p>
              <p>
                - 색상 차이 10% 미만, RGB 색상, 저해상도 이미지 등 파일로 인한
                문제는 불량으로 보지 않습니다. 파일을 고쳐 다시 제작하면
                제작비의 50%가 추가됩니다.
              </p>
              <p>
                - 환불은 재제작이 어렵거나 배송 사고, 출고 지연(5영업일 이상)일
                때만 가능합니다.
              </p>
            </Section>
          </>
        )}
      </div>
    </aside>
  )
}
