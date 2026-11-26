import type { Metadata } from "next";
import { Suspense } from "react";
import { FinanceView } from "./view";

export const metadata: Metadata = { title: "Financeiro" };

export default function Page() {
  return (
    <Suspense>
      <FinanceView />
    </Suspense>
  );
}
