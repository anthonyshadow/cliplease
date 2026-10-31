// Settings → Requests (02 §5.2, 07 D81): the approval window and auto-approve, shared by the Settings action and the
// domain function, which re-parses (the domain is the authority).
import { z } from "zod";
import { APPROVAL_WINDOW_HOURS } from "../domain/values";

export const creatorSettingsSchema = z.object({
  approvalWindowHours: z.literal([...APPROVAL_WINDOW_HOURS]),
  autoApprove: z.boolean(),
});
