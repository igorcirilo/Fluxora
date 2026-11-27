import type { Metadata } from "next";
import { CompanyOnboarding } from "./onboarding";

export const metadata: Metadata = { title: "Cadastrar empresa" };

export default function Page() {
  return <CompanyOnboarding />;
}
