import { NotFoundBody } from "@/components/layout/not-found-body";

// notFound() inside (public) renders here, inside that layout's NavBar and <main>: body only.
export default function PublicNotFound() {
  return <NotFoundBody />;
}
