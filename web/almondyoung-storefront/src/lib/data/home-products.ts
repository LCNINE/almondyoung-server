// 서버사이드 홈 상품 데이터 로딩

import { getProductsByCategoryService } from "@lib/services/pim/products/getProductListService"
import { ProductCard } from "@lib/types/ui/product"
import { PimCategory } from "@lib/types/dto/pim"

export interface HomeProductsData {
  popularProducts: ProductCard[]
  newProducts: ProductCard[]
  welcomeDealProducts: ProductCard[]
  digitalTemplateProducts: ProductCard[]
  categoryProducts: Record<string, ProductCard[]>
}

// 최적화된 홈페이지 데이터 로딩 (API 호출 수 감소)
export async function getHomeProductsDataOptimized(categories: PimCategory[]): Promise<HomeProductsData> {
  try {
    console.log('🚀 [getHomeProductsDataOptimized] 최적화된 데이터 로딩 시작')
    
    // 핵심 데이터만 로딩 (API 호출 수를 5개에서 2개로 감소)
    const apiCalls = []

    // 1. 인기상품만 로딩 (가장 중요한 데이터)
    if (categories.length > 0) {
      apiCalls.push(
        getProductsByCategoryService(categories[0].id, {
          page: 1,
          limit: 8,
          sort: "popular"
        }).then(response => ({
          type: 'popular',
          data: response.items.map((product, index) => ({
            ...product,
            rank: index + 1,
          }))
        }))
      )
    }

    // 2. 신상품 로딩
    if (categories.length > 1) {
      apiCalls.push(
        getProductsByCategoryService(categories[1].id, {
          page: 1,
          limit: 6,
          sort: "created_at"
        }).then(response => ({
          type: 'new',
          data: response.items
        }))
      )
    }

    // 나머지 데이터는 클라이언트 사이드에서 lazy loading
    const results = await Promise.all(apiCalls)

    const homeData: HomeProductsData = {
      popularProducts: [],
      newProducts: [],
      welcomeDealProducts: [],
      categoryProducts: {},
      digitalTemplateProducts: []
    }

    results.forEach(result => {
      switch (result.type) {
        case 'popular':
          homeData.popularProducts = result.data
          break
        case 'new':
          homeData.newProducts = result.data
          break
      }
    })

    console.log('✅ [getHomeProductsDataOptimized] 최적화된 데이터 로딩 완료')
    return homeData
  } catch (error) {
    console.error("❌ [getHomeProductsDataOptimized] 데이터 로드 실패:", error)
    return {
      popularProducts: [],
      newProducts: [],
      welcomeDealProducts: [],
      categoryProducts: {},
      digitalTemplateProducts: []
    }
  }
}

// 기존 함수 (하위 호환성을 위해 유지)
export async function getHomeProductsData(categories: PimCategory[]): Promise<HomeProductsData> {
  try {
    console.log('🚀 [getHomeProductsData] 서버사이드 데이터 로딩 시작')
    
    // 병렬로 실행할 API 호출들
    const apiCalls = []

    // 1. 신상품 (첫 번째 카테고리)
    if (categories.length > 0) {
      apiCalls.push(
        getProductsByCategoryService(categories[0].id, {
          page: 1,
          limit: 5,
          sort: "created_at"
        }).then(response => ({
          type: 'new',
          data: response.items
        }))
      )
    }

    // 2. 인기상품 (두 번째 카테고리)
    if (categories.length > 1) {
      apiCalls.push(
        getProductsByCategoryService(categories[1].id, {
          page: 1,
          limit: 6,
          sort: "name"
        }).then(response => ({
          type: 'popular',
          data: response.items.map((product, index) => ({
            ...product,
            rank: index + 1,
          }))
        }))
      )
    }

    // 3. 웰컴딜 상품
    const welcomeDealCategoryId = "01999bee-bf43-704d-a367-2b49c14c38f2"
    apiCalls.push(
      getProductsByCategoryService(welcomeDealCategoryId, {
        page: 1,
        limit: 7,
        sort: "name",
      }).then(response => ({
        type: 'welcome',
        data: response.items
      })).catch(error => {
        console.error("❌ [웰컴딜] 로드 실패:", error)
        return { type: 'welcome', data: [] }
      })
    )

    // 4. 카테고리 상품들 (첫 3개만 로드)
    const limitedCategoryTabs = categories.slice(0, 3)
    for (const category of limitedCategoryTabs) {
      apiCalls.push(
        getProductsByCategoryService(category.id, {
          page: 1,
          limit: 10,
          sort: "popular",
        }).then(response => ({
          type: 'category',
          categoryId: category.id,
          data: response.items
        })).catch(error => {
          console.error(`❌ [카테고리] ${category.name} 로드 실패:`, error)
          return { type: 'category', categoryId: category.id, data: [] }
        })
      )
    }

    // 5. 디지털 템플릿 상품
    const digitalTemplateCategoryId = "01999869-d76a-775f-863a-2b28e8640054"
    apiCalls.push(
      getProductsByCategoryService(digitalTemplateCategoryId, {
        page: 1,
        limit: 10,
        sort: "popular",
      }).then(response => ({
        type: 'digitalTemplate',
        data: response.items
      }))
    )
    // 모든 API 호출을 병렬로 실행
    console.log(`🔄 [getHomeProductsData] ${apiCalls.length}개 API 호출 병렬 실행`)
    const results = await Promise.all(apiCalls)

    // 결과를 분류하여 저장
    const homeData: HomeProductsData = {
      popularProducts: [],
      newProducts: [],
      welcomeDealProducts: [],
      categoryProducts: {},
      digitalTemplateProducts: []
    }

    results.forEach(result => {
      switch (result.type) {
        case 'new':
          homeData.newProducts = result.data
          break
        case 'popular':
          homeData.popularProducts = result.data
          break
        case 'welcome':
          homeData.welcomeDealProducts = result.data
          break
        case 'category':
          if ('categoryId' in result && result.categoryId) {
            homeData.categoryProducts[result.categoryId as string] = result.data
          }
          break
        case 'digitalTemplate':
          homeData.digitalTemplateProducts = result.data
          break
      }
    })

    console.log('✅ [getHomeProductsData] 서버사이드 데이터 로딩 완료:', {
      newProducts: homeData.newProducts.length,
      popularProducts: homeData.popularProducts.length,
      welcomeDealProducts: homeData.welcomeDealProducts.length,
      categoryCount: Object.keys(homeData.categoryProducts).length,
      digitalTemplateProducts: homeData.digitalTemplateProducts.length
    })

    return homeData
  } catch (error) {
    console.error("❌ [getHomeProductsData] 서버사이드 데이터 로드 실패:", error)
    // 에러 시 빈 데이터 반환
    return {
      popularProducts: [],
      newProducts: [],
      welcomeDealProducts: [],
      categoryProducts: {},
      digitalTemplateProducts: []
    }
  }
}
