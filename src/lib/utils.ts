import { createCn } from "cn/engine";
import tables from "./cn-tables";

/** Tailwind class merging, on tables compiled ahead by `bun run cn:tables` (scripts/cn-tables.ts says why). */
export const cn = createCn(tables);
