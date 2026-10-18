import { createAnthropic } from '@ai-sdk/anthropic';

export function createCredentiallessAnthropicProvider(baseURL: string) {
  return createAnthropic({
    apiKey: 'polaris-credentialless-proxy',
    baseURL,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const headers = new Headers(request.headers);
      headers.delete('x-api-key');
      headers.delete('authorization');
      return fetch(new Request(request, { headers }));
    },
  });
}
