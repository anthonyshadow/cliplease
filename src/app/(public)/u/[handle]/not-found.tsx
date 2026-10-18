import { NotFoundBody } from "@/components/layout/not-found-body";

// An unknown /@handle (05 §10), inside the public NavBar and <main>.
export default function CreatorNotFound() {
  return <NotFoundBody title="No creator here." />;
}
