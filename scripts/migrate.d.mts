import type { Client } from "pg";
export const MIGRATIONS_DIR: string;
export function migrate(client: Client, dir?: string, log?: (msg: string) => void): Promise<string[]>;
