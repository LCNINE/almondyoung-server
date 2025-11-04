// [규칙] 구현 상세를 컴포넌트로 추상화
export default function SurveyHeader() {
  return (
    <header className="inline-flex w-full flex-col items-start justify-start gap-2.5 self-stretch bg-gradient-to-l from-amber-300 to-amber-500 p-7">
      <span className="justify-start font-['Pretendard'] text-2xl font-bold text-white">
        원장님 샵 맞춤정보 등록
      </span>
      <span className="justify-start font-['Pretendard'] text-sm font-normal text-white">
        원장님에 딱 맞춰 홈 설정, 제품 추천 해드려요
      </span>
    </header>
  )
}
