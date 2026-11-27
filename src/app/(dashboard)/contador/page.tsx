import type { Metadata } from "next";
import { AccountantView } from "./view";

export const metadata: Metadata = { title: "Painel do contador" };

export default function Page() {
  return <AccountantView />;
}
