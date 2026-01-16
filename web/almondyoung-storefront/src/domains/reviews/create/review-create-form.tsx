"use client"

import React, { useState } from "react"
import { Rating } from "@components/rating/index"
import { useRating } from "@components/rating/use-rating-hooks"

// --- 1. 메인 컴포넌트: 전체 폼과 레이아웃 ---
// 페이지로 분리할지 바텀에서 위로 올라오게할지 고민
export function ReviewCreateForm() {
  // 별점 상태 관리 - 클릭한 값만 관리 (API 요청 시 사용)
  const { rating, handleRatingChange } = useRating(0)

  const [reviewText, setReviewText] = useState("")
  const [photos, setPhotos] = useState<File[]>([])

  const isSubmitDisabled = reviewText.length < 10 || rating === 0

  // 폼 제출 핸들러 (예시)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // rating은 클릭한 값만 포함 (hover 값 아님)
    // await api.postReview({ rating, text: reviewText, photos })
  }

  return (
    // <form> 태그: 리뷰 '제출'이라는 명확한 목적
    <form
      className="mx-auto flex h-full w-full max-w-sm flex-col bg-white"
      onSubmit={handleSubmit}
    >
      {/* <main> 태그: 스크롤이 필요한 핵심 콘텐츠 영역 */}
      <main className="flex-1 space-y-6 overflow-y-auto p-4">
        {/* 섹션 1: 상품 정보 */}
        <section aria-label="리뷰 대상 상품">
          <ProductInfoCard
            imageUrl="image.png"
            productName="오샤레 킹 파우더 3.4g 점도 조절제"
          />
        </section>

        {/* 섹션 2: 별점 */}
        <section aria-label="상품 만족도" className="space-y-4">
          <p className="text-left text-xs font-medium text-black">
            이 상품에 대해 얼마나 만족하셨나요?
          </p>
          <Rating rating={rating} onChange={handleRatingChange} size={44} />
        </section>

        {/* 섹션 3: 리뷰 텍스트 */}
        <section aria-label="리뷰 내용 작성">
          <ReviewTextArea
            value={reviewText}
            onChange={(e) => setReviewText(e.target.value)}
          />
        </section>

        {/* 섹션 4: 사진 첨부 */}
        <section aria-label="사진 첨부">
          <ReviewPhotoAttachment photos={photos} onPhotosChange={setPhotos} />
        </section>
      </main>

      {/* <footer> 태그: 페이지 하단에 고정되는 버튼 영역
       */}
      <ReviewSubmitFooter isDisabled={isSubmitDisabled} />
    </form>
  )
}

// --- 2. 상품 정보 카드 ---
/**
 * `absolute` 대신 `flex`를 사용하고,
 * `div` 대신 `<figure>`와 `<figcaption>`을 사용합니다.
 */
function ProductInfoCard({
  imageUrl,
  productName,
}: {
  imageUrl: string
  productName: string
}) {
  return (
    <figure className="flex items-center gap-3">
      <img
        className="h-[75px] w-[75px] rounded-[5px] object-cover"
        src={imageUrl}
        alt={productName} // 시맨틱: alt 텍스트 추가
      />
      <figcaption className="text-left text-sm text-black">
        {productName}
      </figcaption>
    </figure>
  )
}

// --- 3. 텍스트 입력 영역 ---
/**
 * `div`와 `p` 태그 조합을 시맨틱 <textarea>로 변경하고
 * `placeholder` 속성을 사용합니다.
 */
function ReviewTextArea({
  value,
  onChange,
}: {
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
}) {
  const placeholderText = "주문하신 상품이 어떠셨나요? (10자 이상)"

  return (
    <textarea
      className="h-[239px] w-full rounded-[5px] border border-[#d9d9d9] p-2.5 align-top text-xs text-black placeholder:text-[#757575]"
      placeholder={placeholderText}
      aria-label={placeholderText}
      minLength={10}
      rows={10}
      value={value}
      onChange={onChange}
    />
  )
}

// --- 4. 사진 첨부 버튼 ---
/**
 * 파일 업로드 기능 구현
 * - 여러 이미지 업로드 지원
 * - 미리보기 표시
 * - 삭제 기능
 */
function ReviewPhotoAttachment({
  photos,
  onPhotosChange,
}: {
  photos: File[]
  onPhotosChange: (photos: File[]) => void
}) {
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) {
      onPhotosChange([...photos, ...files])
    }
    // 같은 파일 다시 선택 가능하도록 초기화
    e.target.value = ""
  }

  const handleRemovePhoto = (index: number) => {
    onPhotosChange(photos.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-3">
      {/* 파일 업로드 버튼 */}
      <div>
        <input
          type="file"
          id="review-photo-upload"
          className="sr-only"
          multiple
          accept="image/*"
          onChange={handleFileChange}
        />
        <label
          htmlFor="review-photo-upload"
          className="inline-flex cursor-pointer items-center gap-[7px]"
        >
          <CameraIcon />
          <span className="text-left text-xs font-medium text-[#ffa500]">
            첨부하기 (포토리뷰 작성시 150원 적립)
          </span>
        </label>
      </div>

      {/* 업로드된 사진 미리보기 - 왼쪽에서 오른쪽으로 배치 */}
      {photos.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {photos.map((photo, index) => (
            <li key={index}>
              <PhotoPreview
                file={photo}
                onRemove={() => handleRemovePhoto(index)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// 사진 미리보기 컴포넌트
function PhotoPreview({
  file,
  onRemove,
}: {
  file: File
  onRemove: () => void
}) {
  const [preview, setPreview] = useState<string>("")
  const [isLoading, setIsLoading] = useState(true)

  React.useEffect(() => {
    const reader = new FileReader()
    reader.onloadend = () => {
      setPreview(reader.result as string)
      setIsLoading(false)
    }
    reader.onerror = () => {
      setIsLoading(false)
    }
    reader.readAsDataURL(file)
  }, [file])

  if (isLoading || !preview) {
    return (
      <figure className="relative flex h-20 w-20 items-center justify-center rounded-[5px] bg-gray-100">
        <span className="text-xs text-gray-400">로딩 중...</span>
      </figure>
    )
  }

  return (
    <figure className="relative h-20 w-20 shrink-0">
      <img
        src={preview}
        alt={`리뷰 사진 ${file.name}`}
        className="h-full w-full rounded-[5px] object-cover"
      />
      <button
        type="button"
        onClick={onRemove}
        className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 text-white transition-opacity hover:opacity-80"
        aria-label="사진 삭제"
      >
        ×
      </button>
    </figure>
  )
}

// --- 5. 하단 버튼 ---
/**
 * 시맨틱 `<footer>` 사용
 * position 없이 일반 블록 레이아웃으로 배치
 */
function ReviewSubmitFooter({ isDisabled }: { isDisabled: boolean }) {
  return (
    <footer className="border-t border-gray-200 bg-white px-2.5 pt-[15px] pb-2.5">
      <p className="mb-2 text-center text-sm font-semibold text-[#757575]">
        원장님의 소중한 의견 감사합니다.
      </p>
      <div className="flex">
        {/* 시맨틱: <button type="submit"> 사용 */}
        <button
          type="submit"
          disabled={isDisabled}
          className="grow items-center justify-center gap-2.5 rounded-[5px] px-4 py-[13px] text-center text-sm text-white enabled:bg-[#ffa500] disabled:bg-[#ffa500]/40"
        >
          리뷰 등록하기
        </button>
      </div>
    </footer>
  )
}

// --- 6. 아이콘 컴포넌트 ---
/**
 * 복잡한 SVG를 별도 컴포넌트로 분리 (원칙 2)
 */
function CameraIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="h-5 w-5"
      preserveAspectRatio="none"
    >
      <g clipPath="url(#clip0_2227_139998)">
        <path
          d="M19.1663 15.8333C19.1663 16.2754 18.9907 16.6993 18.6782 17.0118C18.3656 17.3244 17.9417 17.5 17.4997 17.5H2.49967C2.05765 17.5 1.63372 17.3244 1.32116 17.0118C1.0086 16.6993 0.833008 16.2754 0.833008 15.8333V6.66667C0.833008 6.22464 1.0086 5.80072 1.32116 5.48816C1.63372 5.17559 2.05765 5 2.49967 5H5.83301L7.49967 2.5H12.4997L14.1663 5H17.4997C17.9417 5 18.3656 5.17559 18.6782 5.48816C18.9907 5.80072 19.1663 6.22464 19.1663 6.66667V15.8333Z"
          stroke="#FFA500"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M9.99967 14.1667C11.8406 14.1667 13.333 12.6743 13.333 10.8333C13.333 8.99238 11.8406 7.5 9.99967 7.5C8.15873 7.5 6.66634 8.99238 6.66634 10.8333C6.66634 12.6743 8.15873 14.1667 9.99967 14.1667Z"
          stroke="#FFA500"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      <defs>
        <clipPath id="clip0_2227_139998">
          <rect width={20} height={20} fill="white" />
        </clipPath>
      </defs>
    </svg>
  )
}
