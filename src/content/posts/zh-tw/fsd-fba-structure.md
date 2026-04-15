---
title: 檔案到底在哪裡？前端專案架構介紹（FSD 和 FBA）
published: 2025-08-12
description: ''
image: 'https://repository-images.githubusercontent.com/328463920/c9bc1654-53a8-4c4d-a5b0-94297d564ee2'
tags: [Frontend]
category: 'software development'
draft: false 
lang: ''
---

在前端專案日漸龐大與模組化需求提升的今天，如何設計一個**可擴展、易維護且高內聚的專案架構**成為開發者的重要課題。本文將以 React 為示範語言，深入解析「FSD (Feature-Sliced Design)」與「Feature-based Architecture」的核心理念與實作方式，並透過實戰範例帶你一步步建立一個具備現代前端架構思維的專案。

## Feature-based Architecture 與 FSD 的核心理念

### 1. Feature-based Architecture 是什麼？

Feature-based Architecture (以功能為導向的架構) 強調將專案依據 **功能領域 (feature domain)** 進行劃分，而非依據技術層面 (如 components, hooks, utils) 進行水平切割。其優點包含：

* **High Cohesion**：功能相關的程式碼集中於同一區域，易於理解與修改。
* **Low Coupling**：功能模組之間界線清晰，便於團隊協作與重構。
* **Scalable for Large Teams**：不同開發者可專注於不同 feature，不互相干擾。

### 2. FSD (Feature-Sliced Design)

[FSD](https://feature-sliced.design/) 是 Feature-based Architecture 的進階實踐框架，其提出一套明確的 **層級設計模型 (Layered Model)** 與 **Slice-by-Feature** 概念，有興趣可以看看他們的範例 repo。

::github{repo="feature-sliced/examples"}

FSD 將專案劃分為五大層級：

| 層級            | 說明                                    |
| ------------- | ------------------------------------- |
| **App**       | 應用層，專案的入口與全域設定                        |
| **Processes** | 業務流程層，負責跨 Feature 的複合邏輯               |
| **Pages**     | 頁面層，將多個 Feature 組合為完整頁面               |
| **Features**  | 功能層，封裝具備獨立業務邏輯的單元                     |
| **Entities**  | 實體層，對應 Domain Model，如 User, Product 等 |
| **Shared**    | 共用層，包含 UI 元件、工具函式、設計系統等               |

## 專案結構

```plaintext
src/
├── app/
│   └── App.tsx
├── processes/
│   └── checkout-flow/
├── pages/
│   ├── HomePage/
│   └── ProductPage/
├── features/
│   ├── AddToCart/
│   └── ProductFilter/
├── entities/
│   ├── Cart/
│   └── Product/
├── shared/
│   ├── ui/
│   │   ├── Button/
│   │   └── Modal/
│   ├── lib/
│   └── config/
└── index.tsx
```

### 各層實作說明：

* **app/**：全域路由、Provider、Error Boundary 設定等。
* **processes/**：如 checkout 流程整合 AddToCart、OrderForm 等 Feature。
* **pages/**：純粹負責「組裝與版面配置」，不包含邏輯。
* **features/**：如 AddToCart, ProductFilter，封裝功能邏輯與 UI。
* **entities/**：如 Cart, Product，僅負責 Domain Entity 的資料與操作邏輯。
* **shared/**：全域共用資源 (UI library, 工具函式, API handler)。

## 實戰步驟：用 FSD 架構開發「商品加入購物車」功能

### Step 1: 定義 Entities (Product, Cart)

```tsx
// entities/Product/model/types.ts
export interface Product {
  id: string;
  name: string;
  price: number;
}
```

```tsx
// entities/Cart/model/cartStore.ts
import { create } from 'zustand';

interface CartItem {
  productId: string;
  quantity: number;
}

interface CartState {
  items: CartItem[];
  addItem: (productId: string) => void;
}

export const useCartStore = create<CartState>((set) => ({
  items: [],
  addItem: (productId) => set((state) => ({
    items: [...state.items, { productId, quantity: 1 }]
  }))
}));
```

### Step 2: 建立 Feature - AddToCart

```tsx
// features/AddToCart/ui/AddToCartButton.tsx
import { useCartStore } from '@/entities/Cart';
import { Product } from '@/entities/Product';

export const AddToCartButton = ({ product }: { product: Product }) => {
  const addItem = useCartStore((state) => state.addItem);
  return <button onClick={() => addItem(product.id)}>加入購物車</button>;
};
```

### Step 3: 在 Page 組裝

```tsx
// pages/ProductPage/ui/ProductPage.tsx
import { Product } from '@/entities/Product';
import { AddToCartButton } from '@/features/AddToCart';

const dummyProduct: Product = {
  id: '1',
  name: '測試商品',
  price: 1000,
};

export const ProductPage = () => (
  <div>
    <h1>{dummyProduct.name}</h1>
    <p>{dummyProduct.price} 元</p>
    <AddToCartButton product={dummyProduct} />
  </div>
);
```

### Step 4: Processes - CheckoutFlow

Processes 層會將多個 Feature 組合成跨域業務流程 (設計進階的結帳流程整合 AddToCart, OrderForm, PaymentStep)。

## FSD 與 Feature-based Architecture 的實務效益

| 優點                          | 說明                                                |
| --------------------------- | ------------------------------------------------- |
| **模組邊界清晰**                  | Feature 層封裝業務邏輯，Entities 層聚焦 Domain Model，易於解耦與測試 |
| **適合大型專案與多人協作**             | 不同開發者可專注於各自負責的 Slice，降低衝突                         |
| **靈活擴展與重構**                 | 功能層級的組裝結構，讓你能快速重組頁面流程或替換 Feature 邏輯               |
| **Testable & Maintainable** | Feature 與 Entities 的高內聚設計，自然提升測試與維護效率             |

## 最佳實踐與常見陷阱

### 最佳實踐

1. **從 Slice-by-Feature 思維出發**，而非技術導向拆分 (ex: 把 components, hooks 平鋪在 shared/ 是反模式)
2. **Entities 層只做資料與純邏輯，UI 與 SideEffect 交給 Feature 層**
3. **Process 層適度使用**，避免過度抽象，但複雜業務流程務必導入。

### 常見陷阱

| 陷阱                            | 說明                                  |
| ----------------------------- | ----------------------------------- |
| **目錄層級過深**                    | FSD 並不強制目錄層層嵌套，保持簡潔與實用為主            |
| **把 Feature 當作 UI Library 用** | Feature 應封裝業務邏輯，不只是 UI Component 組合 |
| **Process 層過度設計**             | 當流程不夠複雜時不需要勉強使用 Processes 層         |

## 結語

FSD 與 Feature-based Architecture 是應對大型 React 專案複雜度提升的強大工具。其「**功能導向 + 層級分明**」的設計哲學，能讓專案更具可讀性、可維護性與可擴展性。

