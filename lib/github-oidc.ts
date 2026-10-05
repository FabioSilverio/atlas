import { createRemoteJWKSet, jwtVerify } from "jose";

// GitHub Actions can mint a short-lived OIDC token for each workflow run. We
// accept only tokens signed by GitHub, for this repository's main branch, with
// our audience — so the AI worker needs no shared secret.
const JWKS = createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));
export const OIDC_AUDIENCE = "atlas-ingest";
const REPOSITORY = process.env.ATLAS_REPOSITORY ?? "FabioSilverio/atlas";

export async function verifyGithubActions(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, JWKS, { issuer: "https://token.actions.githubusercontent.com", audience: OIDC_AUDIENCE });
    return payload.repository === REPOSITORY && payload.ref === "refs/heads/main";
  } catch {
    return false;
  }
}
