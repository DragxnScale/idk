import { drizzle } from "drizzle-orm/libsql/node";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "file:./study.db";
const authToken = process.env.DATABASE_AUTH_TOKEN;

export const db = drizzle({
  connection: { url, authToken },
  schema,
});
