import { headers } from "next/headers";
import { PAGE_PATH_HEADER } from "@/lib/sign-in";
import { recordDomain } from "@/server/licensing/verify";
import { NoLicenseFound } from "./no-license-found";
import { requestedCode } from "./requested-code";

// /verify's 404 (01 J10.3, J10.4; owner answer Q-184): a not-found file gets no params, so the code comes from the path
// src/proxy.ts forwards for /verify. Non-canonical input was already 308'd, so an unknown code here is canonical.
export default async function VerifyNotFound() {
  const code = requestedCode((await headers()).get(PAGE_PATH_HEADER));
  return <NoLicenseFound code={code} domain={recordDomain()} />;
}
