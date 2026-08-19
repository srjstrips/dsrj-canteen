import "dotenv/config";
import { execSync } from "child_process";

function testDatabaseUrl(): string {
  const base = process.env.DATABASE_URL ?? "postgresql://dsrj:dsrj_dev_password@localhost:5432/dsrj_canteen?schema=public";
  return process.env.TEST_DATABASE_URL ?? base.replace(/\/([a-zA-Z0-9_]+)(\?|$)/, "/dsrj_canteen_test$2");
}

export default async function globalSetup() {
  const dbUrl = testDatabaseUrl();
  const url = new URL(dbUrl);
  const dbName = url.pathname.slice(1);
  const adminUrl = `${url.protocol}//${url.username}:${url.password}@${url.host}/postgres`;

  try {
    execSync(`psql "${adminUrl}" -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${dbName}"`, { stdio: "pipe" });
  } catch (e) {
    const message = e instanceof Error && "stderr" in e ? String((e as { stderr?: Buffer }).stderr) : String(e);
    if (!/already exists/i.test(message)) throw e;
  }

  execSync("npx tsx src/db/migrate.ts", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: dbUrl },
  });
}
