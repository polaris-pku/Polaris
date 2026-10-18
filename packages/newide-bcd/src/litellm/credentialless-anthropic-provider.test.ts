import { generateText } from 'ai';
import { afterEach, expect, test, vi } from 'vitest';
import { createCredentiallessAnthropicProvider } from './credentialless-anthropic-provider';

afterEach(() => vi.unstubAllGlobals());

test('B model calls use the local account route without API credentials', async () => {
  const seen: Request[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Request(input, init));
    return new Response(
      JSON.stringify({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'test-model',
        content: [{ type: 'text', text: 'ready' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  });
  const provider = createCredentiallessAnthropicProvider('http://127.0.0.1:4143/accounts/test/v1');
  const result = await generateText({ model: provider.messages('test-model'), prompt: 'hello' });
  expect(result.text).toBe('ready');
  const request = seen[0];
  if (!request) throw new Error('Expected a local model request');
  expect(request.url).toBe('http://127.0.0.1:4143/accounts/test/v1/messages');
  expect(request.headers.has('authorization')).toBe(false);
  expect(request.headers.has('x-api-key')).toBe(false);
});
