export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function assertRecord(
  value: unknown,
  description: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${description} 必须是 JSON object。`);
  }
}
