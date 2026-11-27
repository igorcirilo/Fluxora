"use client";
import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

/** Cliente do Better Auth (mesma origem). O segundo fator é tratado na própria tela de entrada. */
export const authClient = createAuthClient({ plugins: [twoFactorClient()] });
