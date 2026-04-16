import { client } from "../client"
import type {
  CategoryDto,
  CategoryTreeResponseDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from "@/lib/types/catalog"

export const categoriesApi = {
  tree: async (maxDepth?: number): Promise<CategoryTreeResponseDto> => {
    const qs = maxDepth ? `?maxDepth=${maxDepth}` : ""
    const response = await client.get(`/categories${qs}`)
    return response.data
  },

  get: async (id: string): Promise<CategoryDto> => {
    const response = await client.get(`/categories/${id}`)
    return response.data
  },

  create: async (dto: CreateCategoryDto): Promise<CategoryDto> => {
    const response = await client.post("/categories", dto)
    return response.data
  },

  update: async (id: string, dto: UpdateCategoryDto): Promise<CategoryDto> => {
    const response = await client.put(`/categories/${id}`, dto)
    return response.data
  },

  delete: async (id: string, moveProductsTo?: string): Promise<void> => {
    const qs = moveProductsTo ? `?moveProductsTo=${moveProductsTo}` : ""
    await client.delete(`/categories/${id}${qs}`)
  },

  reorder: async (dto: {
    parentId?: string
    categoryIds: string[]
  }): Promise<void> => {
    await client.post("/categories/reorder", dto)
  },

  move: async (
    id: string,
    newParentId?: string | null,
  ): Promise<CategoryDto> => {
    const qs =
      newParentId !== undefined ? `?newParentId=${newParentId ?? "null"}` : ""
    const response = await client.put(`/categories/${id}/move${qs}`, {})
    return response.data
  },
}
