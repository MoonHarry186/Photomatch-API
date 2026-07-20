import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthProvider } from '@prisma/client';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { ApiError } from '../common/api-error';
import { OAuthIdentity, OAuthVerifierPort } from './integration.ports';

@Injectable()
export class FakeOAuthVerifier implements OAuthVerifierPort {
  async verify(provider: AuthProvider, idToken: string): Promise<OAuthIdentity> {
    if (provider !== AuthProvider.GOOGLE && provider !== AuthProvider.APPLE) {
      throw ApiError.forbidden('OAUTH_PROVIDER_UNSUPPORTED', 'OAuth provider is not supported');
    }
    const match = /^fake:([^:]+@[^:]+):([^:]+)$/.exec(idToken);
    if (!match) throw ApiError.forbidden('OAUTH_TOKEN_INVALID', 'OAuth identity token is invalid');
    return { email: match[1].toLowerCase(), subject: match[2], emailVerified: true };
  }
}

@Injectable()
export class ProductionOAuthVerifier implements OAuthVerifierPort {
  private readonly googleJwks = createRemoteJWKSet(
    new URL('https://www.googleapis.com/oauth2/v3/certs'),
  );
  private readonly appleJwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

  constructor(private readonly config: ConfigService) {}

  async verify(provider: AuthProvider, idToken: string, nonce?: string): Promise<OAuthIdentity> {
    const definition = this.definition(provider);
    try {
      const result = await jwtVerify(idToken, definition.jwks, {
        issuer: definition.issuer,
        audience: definition.audience,
      });
      this.assertNonce(result.payload, nonce);
      const email = result.payload.email;
      if (typeof email !== 'string' || typeof result.payload.sub !== 'string')
        throw new Error('claims');
      return {
        subject: result.payload.sub,
        email: email.toLowerCase(),
        emailVerified:
          result.payload.email_verified === true || result.payload.email_verified === 'true',
      };
    } catch {
      throw ApiError.forbidden('OAUTH_TOKEN_INVALID', 'OAuth identity token is invalid');
    }
  }

  private definition(provider: AuthProvider): {
    issuer: string;
    audience: string[];
    jwks: ReturnType<typeof createRemoteJWKSet>;
  } {
    if (provider === AuthProvider.GOOGLE) {
      return {
        issuer: 'https://accounts.google.com',
        audience: this.config.getOrThrow<string[]>('GOOGLE_CLIENT_IDS'),
        jwks: this.googleJwks,
      };
    }
    if (provider === AuthProvider.APPLE) {
      return {
        issuer: 'https://appleid.apple.com',
        audience: this.config.getOrThrow<string[]>('APPLE_CLIENT_IDS'),
        jwks: this.appleJwks,
      };
    }
    throw ApiError.forbidden('OAUTH_PROVIDER_UNSUPPORTED', 'OAuth provider is not supported');
  }

  private assertNonce(payload: JWTPayload, nonce?: string): void {
    if (nonce !== undefined && payload.nonce !== nonce) throw new Error('nonce');
  }
}
