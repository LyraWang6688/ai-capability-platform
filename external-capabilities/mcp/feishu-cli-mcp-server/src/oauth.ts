import { createRemoteJWKSet, jwtVerify } from "jose";
import { config } from "./config.js";

export const FEISHU_SCOPES = ["docs:read", "docs:write", "base:read", "base:write"] as const;
export type FeishuScope = (typeof FEISHU_SCOPES)[number];

export interface AuthContext {
  subject: string;
  clientId: string;
  scopes: ReadonlySet<string>;
  expiresAt: number;
}

let remoteJwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function getRemoteJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!config.auth0Issuer) throw new Error("Auth0 is not configured");
  remoteJwks ??= createRemoteJWKSet(new URL(".well-known/jwks.json", config.auth0Issuer), {
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60_000,
  });
  return remoteJwks;
}

function collectScopes(payload: Record<string, unknown>): ReadonlySet<string> {
  const scopes = new Set<string>();
  if (typeof payload.scope === "string") {
    for (const scope of payload.scope.split(/\s+/)) if (scope) scopes.add(scope);
  }
  if (Array.isArray(payload.permissions)) {
    for (const permission of payload.permissions) {
      if (typeof permission === "string" && permission) scopes.add(permission);
    }
  }
  return scopes;
}

export async function verifyAccessToken(token: string): Promise<AuthContext> {
  const { payload } = await jwtVerify(token, getRemoteJwks(), {
    algorithms: ["RS256"],
    issuer: config.auth0Issuer,
    audience: config.auth0Audience,
    requiredClaims: ["sub", "exp", "iat"],
    clockTolerance: 5,
  });

  if (!payload.sub || !payload.exp) throw new Error("Token is missing required claims");
  const clientId =
    typeof payload.client_id === "string"
      ? payload.client_id
      : typeof payload.azp === "string"
        ? payload.azp
        : "unknown";

  return {
    subject: payload.sub,
    clientId,
    scopes: collectScopes(payload),
    expiresAt: payload.exp,
  };
}

export function protectedResourceMetadataUrl(): string {
  return `${config.publicBaseUrl}/.well-known/oauth-protected-resource`;
}

export function bearerChallenge(error: "invalid_token" | "insufficient_scope", description: string, scope?: string): string {
  const params = [
    `resource_metadata="${protectedResourceMetadataUrl()}"`,
    `error="${error}"`,
    `error_description="${description.replace(/["\\]/g, "")}"`,
  ];
  if (scope) params.push(`scope="${scope}"`);
  return `Bearer ${params.join(", ")}`;
}

export function hasScope(scopes: ReadonlySet<string>, required: FeishuScope): boolean {
  return scopes.has(required);
}

export function oauthTool<T extends Record<string, unknown>>(definition: T, scope: FeishuScope) {
  const securitySchemes = [{ type: "oauth2" as const, scopes: [scope] }];
  return {
    ...definition,
    securitySchemes,
    _meta: { ...(definition._meta as Record<string, unknown> | undefined), securitySchemes },
  };
}
