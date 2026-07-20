import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeviceProvider } from '@prisma/client';
import { importPKCS8, SignJWT } from 'jose';
import { request } from 'node:https';
import { URLSearchParams } from 'node:url';
import { PushMessage, PushPort } from './integration.ports';

@Injectable()
export class FakePushAdapter implements PushPort {
  private readonly logger = new Logger(FakePushAdapter.name);

  async send(message: PushMessage): Promise<{ invalidToken: boolean }> {
    this.logger.log(
      JSON.stringify({ event: 'push.accepted', tokenSuffix: message.token.slice(-6) }),
    );
    return { invalidToken: false };
  }
}

@Injectable()
export class ProductionPushAdapter implements PushPort {
  constructor(private readonly config: ConfigService) {}

  async send(message: PushMessage): Promise<{ invalidToken: boolean }> {
    return message.provider === DeviceProvider.EXPO
      ? this.sendExpo(message)
      : this.sendFcm(message);
  }

  private async sendExpo(message: PushMessage): Promise<{ invalidToken: boolean }> {
    const response = await postJson<{ data?: { status?: string; details?: { error?: string } } }>(
      'https://exp.host/--/api/v2/push/send',
      {
        to: message.token,
        title: message.title,
        body: message.body,
        data: message.data,
      },
      this.config.get<string>('EXPO_ACCESS_TOKEN')
        ? { authorization: `Bearer ${this.config.get<string>('EXPO_ACCESS_TOKEN')}` }
        : {},
    );
    const error = response.body.data?.details?.error;
    const invalidToken = error === 'DeviceNotRegistered';
    if (!invalidToken && (response.statusCode >= 400 || response.body.data?.status === 'error')) {
      throw new Error(`Expo push failed with ${response.statusCode}${error ? `: ${error}` : ''}`);
    }
    return { invalidToken };
  }

  private async sendFcm(message: PushMessage): Promise<{ invalidToken: boolean }> {
    const accessToken = await this.fcmAccessToken();
    const projectId = this.config.getOrThrow<string>('FCM_PROJECT_ID');
    const response = await postJson<{ error?: { status?: string } }>(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
      {
        message: {
          token: message.token,
          notification: { title: message.title, body: message.body },
          data: message.data,
        },
      },
      { authorization: `Bearer ${accessToken}` },
    );
    const invalidToken =
      response.statusCode === 404 ||
      response.body.error?.status === 'NOT_FOUND' ||
      response.body.error?.status === 'UNREGISTERED';
    if (!invalidToken && response.statusCode >= 400) {
      throw new Error(`FCM push failed with ${response.statusCode}`);
    }
    return { invalidToken };
  }

  private async fcmAccessToken(): Promise<string> {
    const email = this.config.getOrThrow<string>('FCM_CLIENT_EMAIL');
    const privateKey = await importPKCS8(
      this.config.getOrThrow<string>('FCM_PRIVATE_KEY'),
      'RS256',
    );
    const assertion = await new SignJWT({
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
    })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(email)
      .setAudience('https://oauth2.googleapis.com/token')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
    const params = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    });
    const response = await postForm<{ access_token?: string }>(
      'https://oauth2.googleapis.com/token',
      params.toString(),
    );
    if (response.statusCode >= 400) {
      throw new Error(`FCM OAuth token request failed with ${response.statusCode}`);
    }
    if (!response.body.access_token) throw new Error('FCM OAuth token response is invalid');
    return response.body.access_token;
  }
}

function postJson<T>(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ statusCode: number; body: T }> {
  return post<T>(url, JSON.stringify(body), { 'content-type': 'application/json', ...headers });
}

function postForm<T>(url: string, body: string): Promise<{ statusCode: number; body: T }> {
  return post<T>(url, body, { 'content-type': 'application/x-www-form-urlencoded' });
}

function post<T>(
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<{ statusCode: number; body: T }> {
  return new Promise((resolve, reject) => {
    const operation = request(url, { method: 'POST', headers }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => (data += chunk));
      response.on('end', () => {
        let parsed: T;
        try {
          parsed = (data ? JSON.parse(data) : {}) as T;
        } catch {
          return reject(new Error('Push provider returned invalid JSON'));
        }
        const statusCode = response.statusCode ?? 500;
        if (statusCode >= 500) return reject(new Error(`Push provider failed with ${statusCode}`));
        resolve({ statusCode, body: parsed });
      });
    });
    operation.on('error', reject);
    operation.setTimeout(10_000, () => operation.destroy(new Error('Push provider timed out')));
    operation.end(body);
  });
}
