import postgres from "postgres";

export function adminDb() {
  const url = process.env.DATABASE_URL_ADMIN;
  if (!url) throw new Error("DATABASE_URL_ADMIN is not set (expected in .env.local)");
  return postgres(url, { prepare: false, onnotice: () => {} });
}
