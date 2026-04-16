---
title: "Where Are the Files, Anyway? A Frontend Project Structure Guide (FSD and FBA)"
published: 2025-08-12
description: ''
image: 'https://repository-images.githubusercontent.com/328463920/c9bc1654-53a8-4c4d-a5b0-94297d564ee2'
tags: ["Frontend"]
category: 'software development'
draft: false 
lang: 'en'
---

As frontend projects continue to grow in size and require stronger modularity, designing a **scalable, maintainable, and highly cohesive project structure** has become an important topic for developers. In this article, I’ll use React as the example language to break down the core ideas and implementation approaches behind "FSD (Feature-Sliced Design)" and "Feature-based Architecture," then walk through a hands-on example step by step to build a project with a modern frontend architectural mindset.

## The Core Ideas Behind Feature-based Architecture and FSD

### 1. What Is Feature-based Architecture?

Feature-based Architecture emphasizes organizing a project around **feature domains** rather than splitting it horizontally by technical type, such as `components`, `hooks`, or `utils`. Its advantages include:

* **High Cohesion**: Code related to the same feature is kept in one area, making it easier to understand and modify.
* **Low Coupling**: Boundaries between feature modules are clear, which helps collaboration and refactoring.
* **Scalable for Large Teams**: Different developers can focus on different features without stepping on each other.

### 2. FSD (Feature-Sliced Design)

[FSD](https://feature-sliced.design/) is a more advanced framework for practicing Feature-based Architecture. It proposes a clear **Layered Model** together with the concept of **Slice-by-Feature**. If you’re interested, you can also take a look at their example repo.

::github{repo="feature-sliced/examples"}

FSD divides a project into six major layers:

| Layer           | Description                                            |
| --------------- | ------------------------------------------------------ |
| **App**         | Application layer, including the entry point and global setup |
| **Processes**   | Business process layer, responsible for cross-feature composite logic |
| **Pages**       | Page layer, combining multiple features into complete pages |
| **Features**    | Feature layer, encapsulating units with independent business logic |
| **Entities**    | Entity layer, corresponding to domain models such as User and Product |
| **Shared**      | Shared layer, including UI components, utility functions, design systems, and more |

## Project Structure

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

### What Each Layer Does

* **app/**: Global routing, providers, error boundaries, and other app-wide setup.
* **processes/**: For example, a checkout flow that integrates features such as AddToCart and OrderForm.
* **pages/**: Responsible only for composition and layout, without business logic.
* **features/**: Such as AddToCart or ProductFilter, encapsulating both feature logic and UI.
* **entities/**: Such as Cart or Product, responsible only for domain entity data and operations.
* **shared/**: Globally shared resources such as a UI library, utility functions, and API handlers.

## Practical Walkthrough: Building an "Add to Cart" Feature with FSD

### Step 1: Define Entities (Product, Cart)

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

### Step 2: Create the Feature - AddToCart

```tsx
// features/AddToCart/ui/AddToCartButton.tsx
import { useCartStore } from '@/entities/Cart';
import { Product } from '@/entities/Product';

export const AddToCartButton = ({ product }: { product: Product }) => {
  const addItem = useCartStore((state) => state.addItem);
  return <button onClick={() => addItem(product.id)}>Add to Cart</button>;
};
```

### Step 3: Assemble It in the Page

```tsx
// pages/ProductPage/ui/ProductPage.tsx
import { Product } from '@/entities/Product';
import { AddToCartButton } from '@/features/AddToCart';

const dummyProduct: Product = {
  id: '1',
  name: 'Test Product',
  price: 1000,
};

export const ProductPage = () => (
  <div>
    <h1>{dummyProduct.name}</h1>
    <p>{dummyProduct.price} NTD</p>
    <AddToCartButton product={dummyProduct} />
  </div>
);
```

### Step 4: Processes - CheckoutFlow

The Processes layer combines multiple features into cross-domain business flows, such as a more advanced checkout flow that integrates AddToCart, OrderForm, and PaymentStep.

## Practical Benefits of FSD and Feature-based Architecture

| Advantage                     | Description |
| ---------------------------- | ----------- |
| **Clear module boundaries**  | The Feature layer encapsulates business logic, while the Entities layer focuses on domain models, making decoupling and testing easier |
| **Great for large projects and team collaboration** | Different developers can focus on the slices they own, reducing conflicts |
| **Flexible expansion and refactoring** | A feature-level composition structure makes it easy to reorganize page flows or replace feature logic quickly |
| **Testable and Maintainable**  | The high cohesion of Features and Entities naturally improves testability and maintainability |

## Best Practices and Common Pitfalls

### Best Practices

1. **Start from a Slice-by-Feature mindset**, not a technology-oriented split. For example, flattening `components` and `hooks` into `shared/` is an anti-pattern.
2. **Keep the Entities layer focused on data and pure logic only, and leave UI and side effects to the Feature layer.**
3. **Use the Processes layer appropriately.** Avoid over-abstraction, but bring it in when the business flow is truly complex.

### Common Pitfalls

| Pitfall                       | Description |
| ---------------------------- | ----------- |
| **Directory nesting that is too deep** | FSD does not require endlessly nested directories. Keep things concise and practical |
| **Treating Features as a UI library** | A Feature should encapsulate business logic, not just a combination of UI components |
| **Overengineering the Processes layer** | If the flow is not complex enough, there is no need to force the use of the Processes layer |

## Conclusion

FSD and Feature-based Architecture are powerful tools for handling the growing complexity of large React projects. Their design philosophy of "**feature-oriented structure with clear layers**" can make a project more readable, maintainable, and scalable.
