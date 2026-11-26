import type { Metadata } from "next";
import { CustomersView } from "./view";

export const metadata: Metadata = { title: "Clientes" };

export default function Page() {
  return <CustomersView />;
}
