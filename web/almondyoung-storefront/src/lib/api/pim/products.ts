"use server"

import { api } from "../api"

export const getProductByMasterId = async (masterId: string) => {
  const result = await api("pim", "/products", {
    method: "GET",
    params: {
      masterId,
    },
    withAuth: false,
  })

  return result
}
