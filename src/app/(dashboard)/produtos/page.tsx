import type { Metadata } from "next";
import { Suspense } from "react";
import { ProductsView } from "./view";

export const metadata: Metadata = { title: "Produtos e estoque" };

export default function Page() {
  return (
    <Suspense>
      <ProductsView />
    </Suspense>
  );
}
