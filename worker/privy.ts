/**
 * Checks Privy's identity token on the server. Privy signs it (ES256); we verify the
 * signature with Privy's published keys, the issuer ("privy.io") and our app ID as audience.
 * No Privy secret is needed.
 */
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import { identityFromLinkedAccounts, type PrivyIdentity } from "../shared/founder.ts";
import type { Env } from "./env.ts";

const keySets = new Map<string, JWTVerifyGetKey>();
export function privyKeys(appId: string): JWTVerifyGetKey {
  let keys = keySets.get(appId);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${encodeURIComponent(appId)}/jwks.json`));
    keySets.set(appId, keys);
  }
  return keys;
}

export class PrivyTokenError extends Error {}

export async function verifyIdentityToken(
  token: string,
  env: Env,
  getKey: JWTVerifyGetKey = privyKeys(env.PRIVY_APP_ID ?? ""),
): Promise<PrivyIdentity> {
  if (!env.PRIVY_APP_ID) throw new PrivyTokenError("Sign-in isn't configured yet.");
  try {
    const { payload } = await jwtVerify(token, getKey, {
      issuer: "privy.io",
      audience: env.PRIVY_APP_ID,
      algorithms: ["ES256"],
    });
    if (typeof payload.sub !== "string" || !payload.sub) throw new PrivyTokenError("The sign-in token has no user.");
    return identityFromLinkedAccounts(payload.sub, payload.linked_accounts);
  } catch (err) {
    if (err instanceof PrivyTokenError) throw err;
    throw new PrivyTokenError("Your sign-in couldn't be confirmed. Please sign in again.");
  }
}
