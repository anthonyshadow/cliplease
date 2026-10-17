import { createCn } from "cn/config";

/** The 04 §4.2 type scale: the `--text-*` names in globals.css. */
export const TYPE_SCALE = [
  "display",
  "title-1",
  "title-2",
  "body",
  "callout",
  "footnote",
  "caption",
] as const;

// cn's default tables read `text-body` and the other scale names as text colors, so merging one with
// `text-ink` would drop either the size or the color. Registering them as sizes keeps both.
export const cn = createCn({
  extend: {
    classGroups: { "font-size": [{ text: [...TYPE_SCALE] }] },
  },
});
