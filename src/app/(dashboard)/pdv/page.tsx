import type { Metadata } from "next";
import { PosView } from "./view";

export const metadata: Metadata = { title: "PDV" };

export default function Page() {
  return <PosView />;
}
