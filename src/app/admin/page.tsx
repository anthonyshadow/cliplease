import type { Metadata } from "next";
import { requireAdmin } from "@/server/auth/session";

// The title runs the gate too: metadata resolves apart from rendering, so a static title would name the 404 that
// everyone else gets "Admin". (A gate in the layout's generateMetadata instead leaves the 404 with no title.)
export async function generateMetadata(): Promise<Metadata> {
  await requireAdmin();
  return { title: "Admin" };
}

// The admin placeholder: an empty body until P21.
export default async function AdminPage() {
  await requireAdmin();
  return <h1 className="sr-only">Admin</h1>;
}
