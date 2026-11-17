import { randomBytes } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { adminDb } from "./db-admin";

const admin = new URL(process.env.DATABASE_URL_ADMIN!);
const [, projectRef] = decodeURIComponent(admin.username).split(".");
if (!projectRef || !admin.hostname.includes("pooler.supabase.com")) {
  throw new Error("DATABASE_URL_ADMIN must be the Supabase *pooler* URL (user postgres.<project-ref>, host *.pooler.supabase.com)");
}

const sql = adminDb();
const urls: Record<string, string> = {};
for (const [role, envName] of [["chatbot_reader", "DATABASE_URL_READER"], ["chatbot_logger", "DATABASE_URL_LOGGER"]]) {
  const password = randomBytes(24).toString("hex");
  await sql.unsafe(`alter role ${role} with password '${password}'`);
  urls[envName] = `postgresql://${role}.${projectRef}:${password}@${admin.hostname}:6543/postgres`;
}
await sql.end();

let env = readFileSync(".env.local", "utf8");
for (const [k, v] of Object.entries(urls)) {
  const line = `${k}=${v}`;
  env = new RegExp(`^${k}=.*$`, "m").test(env) ? env.replace(new RegExp(`^${k}=.*$`, "m"), line) : `${env.trimEnd()}\n${line}\n`;
}
writeFileSync(".env.local", env);
console.log("Passwords set. Wrote DATABASE_URL_READER and DATABASE_URL_LOGGER to .env.local");
