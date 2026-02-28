import { drizzle } from "drizzle-orm/libsql/node";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "file:./study.db";

export const db = drizzle({
  connection: { url },
  schema,
});
