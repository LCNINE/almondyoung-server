"use server"

import type {
  AlmondDesignCreatedDto,
  AlmondDesignDto,
  CreateAlmondDesignDto,
} from "@/lib/types/dto/almond-design"
import { parseDesign } from "@/domains/almond-template/lib/document"
import { api } from "../api"

export const createAlmondDesign = async (
  dto: CreateAlmondDesignDto
): Promise<AlmondDesignCreatedDto> => {
  parseDesign(dto.design)
  return await api<AlmondDesignCreatedDto>("ugc", `/almond-designs`, {
    method: "POST",
    body: dto,
    withAuth: true,
  })
}

export const getAlmondDesign = async (id: string): Promise<AlmondDesignDto> =>
  await api<AlmondDesignDto>("ugc", `/almond-designs/${id}`, {
    method: "GET",
    withAuth: true,
    cache: "no-store",
  })
