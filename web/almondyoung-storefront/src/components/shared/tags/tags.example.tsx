"use client"
// 태그 컴포넌트 예시. 궁금하면 통째로 import해서 확인해보세요.
import { Tag } from "./tag"

/**
 * 다양한 Tag 상태를 한 번에 보여주는 예제 컴포넌트
 */
export const TagExamples: React.FC = () => {
  return (
    <div className="flex flex-col space-y-4 p-4">
      {/* 기본 태그들 */}
      <div className="flex flex-wrap gap-2">
        <Tag>기본 태그</Tag>
        <Tag className="cursor-not-allowed opacity-50">비활성화된 태그</Tag>
        <Tag onRemove={() => console.log("Tag removed")}>삭제 가능 태그</Tag>
      </div>

      {/* 작은 태그들 */}
      <div className="flex flex-wrap gap-2">
        <Tag size="sm">작은 태그</Tag>
        <Tag size="sm" className="cursor-not-allowed opacity-50">
          작은 비활성화 태그
        </Tag>
        <Tag size="sm" onRemove={() => console.log("Tag removed")}>
          작은 삭제 가능 태그
        </Tag>
      </div>

      {/* 큰 태그들 */}
      <div className="flex flex-wrap gap-2">
        <Tag size="lg">큰 태그</Tag>
        <Tag size="lg" className="cursor-not-allowed opacity-50">
          큰 비활성화 태그
        </Tag>
        <Tag size="lg" onRemove={() => console.log("Tag removed")}>
          큰 삭제 가능 태그
        </Tag>
      </div>
    </div>
  )
}

export default TagExamples
