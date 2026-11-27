import type { Metadata } from "next";
import { AccountEntry } from "./account-entry";

export const metadata: Metadata = { title: "Entrar com conta" };

export default function Page() {
  return <AccountEntry />;
}
