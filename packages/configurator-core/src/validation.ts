import type { ConfigureInput } from './types.js';

/** Rejects values that would create ambiguous or unsafe client configuration. */
export function assertConfigureInput(input: ConfigureInput): void {
  if (input.baseUrl !== input.baseUrl.trim()) {
    throw new Error('服务地址不能包含首尾空白。');
  }
  let url: URL;
  try {
    url = new URL(input.baseUrl);
  } catch {
    throw new Error(`服务地址不是合法 URL：${input.baseUrl}`);
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('服务地址必须是无账号、查询参数和片段的 HTTP(S) URL。');
  }
  if (!input.apiKey.trim()) throw new Error('API Key 不能为空。');
  for (const model of [input.primaryModel, input.smallModel]) {
    if (model !== undefined && !model.trim()) {
      throw new Error('模型 ID 不能为空。');
    }
  }
  for (const model of input.availableModels ?? []) {
    if (!model.id.trim()) throw new Error('可用模型列表包含空 ID。');
  }
}
