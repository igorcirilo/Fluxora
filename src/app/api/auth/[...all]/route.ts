import { toNextJsHandler } from "better-auth/next-js";
import { apiError } from "@/lib/api";
import { isDatabaseConfigured } from "@/lib/db/pool";
import { getAuth } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

async function handle(req: Request, method: "GET" | "POST") {
  if (!isDatabaseConfigured()) return apiError("ACCOUNTS_DISABLED", "Contas reais não estão habilitadas neste ambiente.", 503);
  return toNextJsHandler(getAuth())[method](req);
}

export const GET = (req: Request) => handle(req, "GET");
export const POST = (req: Request) => handle(req, "POST");
