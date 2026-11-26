import type { Metadata } from "next";
import { SalesView } from "./view";

export const metadata: Metadata = { title: "Vendas" };

export default function Page() {
  return <SalesView />;
}
