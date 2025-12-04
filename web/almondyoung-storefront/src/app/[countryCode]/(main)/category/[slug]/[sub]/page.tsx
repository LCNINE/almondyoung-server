"use client"

import { useState } from "react"

import { BasicProductCard } from "@components/products/product-card"
import ProductFilterSidebar from "@components/product-filter-sidebar"
import ProductSortToolbar from "@components/product-sort-toolbar"
// TODO: 서버에서 데이터를 받아서 props로 전달하도록 변경 필요

// 그냥 헤어페이지에서 클라이언트 사이드렌더링으로 쿼리스트링만 바꿀까 페이지를 분리할까 고민중

export default function HairSubPage() {
  return (
    <main className="">
      <div className="container mx-auto max-w-[1360px]">
        <div className="flex px-4 py-6 md:gap-[40px] md:px-[40px]">
          <aside className="hidden w-[233px] flex-shrink-0 md:block">
            <ProductFilterSidebar />
          </aside>
          <div>
            <section>
              <ProductSortToolbar />

              {/* Product Grid */}
              {/* TODO: 서버에서 받은 데이터를 props로 전달받아서 렌더링 */}
              {false && (
                <>
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                    {/* {products.map((product, idx) => (
                      <BasicProductCard
                        key={`${product.id}-${idx}`}
                        product={product}
                      />
                    ))} */}
                  </div>
                </>
              )}
            </section>
          </div>
        </div>
      </div>
    </main>
  )
}
