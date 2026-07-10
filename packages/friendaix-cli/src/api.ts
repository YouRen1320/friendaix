import type { ModelOption } from 'friendaix-core';

export async function fetchModels(
  baseUrl: string,
  apiKey: string,
  timeoutMs = 6000,
): Promise<ModelOption[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
      signal: controller.signal,
      headers: { authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const data = (body as Record<string, unknown>).data;
    if (!Array.isArray(data)) return null;
    const models: ModelOption[] = [];
    for (const item of data) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      if (typeof record.id !== 'string' || !record.id) continue;
      models.push({
        id: record.id,
        ...(typeof record.display_name === 'string'
          ? { displayName: record.display_name }
          : {}),
      });
    }
    return models;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface ProbeResult {
  ok: boolean;
  status: number;
  hint?: string;
}

async function runProbe(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (response.ok) return { ok: true, status: response.status };
    const body = await response.text().catch(() => '');
    return {
      ok: false,
      status: response.status,
      hint: humanizeError(response.status, body),
    };
  } catch (error: unknown) {
    return {
      ok: false,
      status: 0,
      hint: `网络错误：${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function probeClaude(
  baseUrl: string,
  apiKey: string,
  model: string,
  timeoutMs = 8000,
): Promise<ProbeResult> {
  return runProbe(
    `${baseUrl.replace(/\/$/, '')}/messages`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: '.' }],
      }),
    },
    timeoutMs,
  );
}

export function probeCodex(
  baseUrl: string,
  apiKey: string,
  model: string,
  timeoutMs = 8000,
): Promise<ProbeResult> {
  return runProbe(
    `${baseUrl.replace(/\/$/, '')}/responses`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_output_tokens: 16,
        input: '.',
      }),
    },
    timeoutMs,
  );
}

export function probeOpenCode(
  baseUrl: string,
  apiKey: string,
  model: string,
  timeoutMs = 8000,
): Promise<ProbeResult> {
  return runProbe(
    `${baseUrl.replace(/\/$/, '')}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: '.' }],
      }),
    },
    timeoutMs,
  );
}

function humanizeError(status: number, body: string): string {
  const lower = body.toLowerCase();
  if (status === 503 && lower.includes('no available accounts')) {
    return '服务端当前分组没有可用上游账号（503）。';
  }
  if (status === 401) return '密钥无效或已禁用（401）。';
  if (status === 403) return '该密钥无权调用此端点（403）。';
  if (status === 404) return '端点不存在（404），请检查服务地址。';
  if (status === 429) return '触发限流（429），请稍后重试。';
  return `HTTP ${status}: ${body.slice(0, 200)}`;
}
