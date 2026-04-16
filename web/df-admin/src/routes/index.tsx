import { createBrowserRouter, Navigate } from "react-router-dom"
import { MainLayout } from "@/components/layout/main-layout"

export const router = createBrowserRouter([
  {
    path: "/",
    element: <MainLayout />,
    children: [
      { index: true, element: <Navigate to="/catalog/products" replace /> },
      {
        path: "catalog/products",
        lazy: () => import("./catalog/product-list-page"),
      },
      {
        path: "catalog/products/:masterId",
        lazy: () => import("./catalog/product-detail-page"),
      },
      {
        path: "catalog/categories",
        lazy: () => import("./catalog/category-page"),
      },
      {
        path: "catalog/tags",
        lazy: () => import("./catalog/tag-page"),
      },
    ],
  },
])
