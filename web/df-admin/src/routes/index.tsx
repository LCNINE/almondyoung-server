import { createBrowserRouter, Navigate } from "react-router-dom"
import { MainLayout } from "@/components/layout/main-layout"
import { RequireAuth } from "@/features/auth/require-auth"
import { RootLayout } from "./root-layout"

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      {
        path: "/login",
        lazy: () => import("./login-page"),
      },
      {
        path: "/",
        element: (
          <RequireAuth>
            <MainLayout />
          </RequireAuth>
        ),
        children: [
          { index: true, element: <Navigate to="/catalog/products" replace /> },
          {
            path: "catalog/products",
            lazy: () => import("./catalog/product-list-page"),
          },
          {
            path: "catalog/products/drafts",
            lazy: () => import("./catalog/product-drafts-page"),
          },
          {
            path: "catalog/products/:masterId",
            lazy: () => import("./catalog/product-detail-page"),
          },
          {
            path: "catalog/products/:masterId/versions/:versionId",
            lazy: () => import("./catalog/product-version-detail-page"),
          },
          {
            path: "catalog/categories",
            lazy: () => import("./catalog/category-page"),
          },
          {
            path: "catalog/tags",
            lazy: () => import("./catalog/tag-page"),
          },
          {
            path: "inventory/skus",
            lazy: () => import("./inventory/sku-list-page"),
          },
          {
            path: "inventory/skus/:skuId",
            lazy: () => import("./inventory/sku-detail-page"),
          },
          {
            path: "matching/order-lines",
            lazy: () => import("./matching/order-lines-page"),
          },
        ],
      },
    ],
  },
])
