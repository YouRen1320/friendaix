import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, test } from 'vitest';
import {
  fetchModels,
  probeClaude,
  probeCodex,
  probeOpenCode,
} from '../src/api.js';

interface TestServer {
  baseUrl: string;
  close(): Promise<void>;
}

async function startServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<TestServer> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function requestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

describe('FriendAIX API compatibility', () => {
  test('reads an OpenAI-compatible model list and ignores malformed entries', async () => {
    let authorization: string | undefined;
    let requestedPath: string | undefined;
    const server = await startServer((request, response) => {
      authorization = request.headers.authorization;
      requestedPath = request.url;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          data: [
            { id: 'model-a', display_name: 'Model A' },
            { id: '' },
            null,
            { id: 'model-b' },
          ],
        }),
      );
    });
    try {
      await expect(fetchModels(server.baseUrl, 'test-key')).resolves.toEqual([
        { id: 'model-a', displayName: 'Model A' },
        { id: 'model-b' },
      ]);
      expect(requestedPath).toBe('/v1/models');
      expect(authorization).toBe('Bearer test-key');
    } finally {
      await server.close();
    }
  });

  test('probes the same endpoints and authentication styles as each client', async () => {
    const requests: Array<{
      path: string;
      authorization?: string;
      anthropicVersion?: string;
      legacyApiKey?: string;
      body: unknown;
    }> = [];
    const server = await startServer((request, response) => {
      void requestBody(request).then((body) => {
        requests.push({
          path: request.url ?? '',
          authorization: request.headers.authorization,
          anthropicVersion: request.headers['anthropic-version'] as
            string | undefined,
          legacyApiKey: request.headers['x-api-key'] as string | undefined,
          body,
        });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{}');
      });
    });
    try {
      await expect(
        probeClaude(server.baseUrl, 'claude-key', 'claude-model'),
      ).resolves.toMatchObject({ ok: true, status: 200 });
      await expect(
        probeCodex(server.baseUrl, 'codex-key', 'codex-model'),
      ).resolves.toMatchObject({ ok: true, status: 200 });
      await expect(
        probeOpenCode(server.baseUrl, 'opencode-key', 'opencode-model'),
      ).resolves.toMatchObject({ ok: true, status: 200 });

      expect(requests.map(({ path }) => path)).toEqual([
        '/v1/messages',
        '/v1/responses',
        '/v1/chat/completions',
      ]);
      expect(requests[0]).toMatchObject({
        authorization: 'Bearer claude-key',
        anthropicVersion: '2023-06-01',
        legacyApiKey: undefined,
        body: { model: 'claude-model', max_tokens: 1 },
      });
      expect(requests[1]).toMatchObject({
        authorization: 'Bearer codex-key',
        body: { model: 'codex-model', max_output_tokens: 16 },
      });
      expect(requests[2]).toMatchObject({
        authorization: 'Bearer opencode-key',
        body: { model: 'opencode-model', max_tokens: 1 },
      });
    } finally {
      await server.close();
    }
  });

  test('turns common HTTP failures into actionable hints', async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end('{"error":"no available accounts"}');
    });
    try {
      await expect(
        probeOpenCode(server.baseUrl, 'key', 'model'),
      ).resolves.toMatchObject({
        ok: false,
        status: 503,
        hint: expect.stringContaining('没有可用上游账号'),
      });
    } finally {
      await server.close();
    }
  });

  test('aborts a probe that exceeds its timeout', async () => {
    const server = await startServer(() => {
      // Intentionally leave the request open so AbortController owns the timeout.
    });
    try {
      await expect(
        probeCodex(server.baseUrl, 'key', 'model', 20),
      ).resolves.toMatchObject({
        ok: false,
        status: 0,
        hint: expect.stringContaining('网络错误'),
      });
    } finally {
      await server.close();
    }
  });
});
