import React from "react"
import { CustomButton } from "@/components/shared/custom-buttons/custom-button"

interface CartEmptyStateProps {
  type: "login" | "empty"
}

export function CartEmptyState({ type }: CartEmptyStateProps) {
  if (type === "login") {
    return (
      <div className="page-wrapper">
        <main className="main-container min-h-screen w-full bg-white lg:bg-white">
          <div className="main-inner md:mx-auto md:max-w-[1280px] md:px-8">
            <div className="flex items-center justify-center py-20">
              <div className="text-center">
                <h2 className="mb-4 text-2xl font-bold text-gray-900">
                  로그인이 필요합니다
                </h2>
                <p className="mb-6 text-gray-600">
                  장바구니를 보려면 로그인해주세요.
                </p>
                <CustomButton variant="primary" size="lg">
                  로그인하기
                </CustomButton>
              </div>
            </div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="page-wrapper">
      <main className="main-container min-h-screen w-full bg-white lg:bg-white">
        <div className="main-inner md:mx-auto md:max-w-[1280px] md:px-8">
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <h2 className="mb-4 text-2xl font-bold text-gray-900">
                장바구니가 비어있습니다
              </h2>
              <p className="mb-6 text-gray-600">
                원하는 상품을 장바구니에 담아보세요.
              </p>
              <CustomButton variant="primary" size="lg">
                쇼핑 계속하기
              </CustomButton>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
