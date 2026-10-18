// Public URLs of a creator and their videos (02 §4.3: /@handle is rewritten to /u/handle).
export const creatorUrl = (handle: string) => `/@${handle}`;
export const videoUrl = (handle: string, slug: string) => `/@${handle}/${slug}`;
