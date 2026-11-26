import type { Metadata } from "next";
import { FiscalView } from "./view";

export const metadata: Metadata = { title: "Fiscal" };

export default function Page() {
  return <FiscalView />;
}
