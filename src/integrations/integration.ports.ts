import { AuthProvider } from '@prisma/client';
import { DeviceProvider } from '@prisma/client';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export abstract class EmailPort {
  abstract send(message: EmailMessage): Promise<void>;
}

export interface OAuthIdentity {
  subject: string;
  email: string;
  emailVerified: boolean;
}

export abstract class OAuthVerifierPort {
  abstract verify(provider: AuthProvider, idToken: string, nonce?: string): Promise<OAuthIdentity>;
}

export interface PushMessage {
  provider: DeviceProvider;
  token: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

export abstract class PushPort {
  abstract send(message: PushMessage): Promise<{ invalidToken: boolean }>;
}
