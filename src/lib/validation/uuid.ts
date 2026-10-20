import { z } from "zod";

const uuid = z.uuid();

/** A route or page id that is a uuid: anything else is answered with 404 before any query. */
export const isUuid = (id: string): boolean => uuid.safeParse(id).success;
