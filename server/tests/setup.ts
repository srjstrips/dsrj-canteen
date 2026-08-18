import "dotenv/config";

const base = process.env.DATABASE_URL ?? "postgresql://dsrj:dsrj_dev_password@localhost:5432/dsrj_canteen?schema=public";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? base.replace(/\/([a-zA-Z0-9_]+)(\?|$)/, "/dsrj_canteen_test$2");
