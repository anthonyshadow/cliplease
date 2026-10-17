// src/db/schema/columns.ts
import { timestamp, uuid } from "drizzle-orm/pg-core";

/** Domain primary key. DB default gen_random_uuid(); app may pass crypto.randomUUID() when it needs the id first. */
export const pk = () => uuid("id").defaultRandom().primaryKey();
/** timestamptz, JS Date in and out. */
export const tstz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
export const createdAt = () => tstz("created_at").notNull().defaultNow();
/** $onUpdate fires only through Drizzle's update() builder; raw SQL must set updated_at = now(). */
export const updatedAt = () =>
  tstz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
