import type { Metadata } from "next";
import { DashboardView } from "./view";

export const metadata: Metadata = { title: "Painel" };

export default function Page() {
  return <DashboardView />;
}
