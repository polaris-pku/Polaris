import { getTransport } from './transport';
import type { SystemReadiness } from './types/system';

export const systemApi = {
  ping: () => getTransport().call('system.ping', {}),
  liveness: () => getTransport().call('system.liveness', {}),
  readiness: () => getTransport().call('system.readiness', {}),
  capabilities: (required?: string[]) =>
    getTransport().call('system.capabilities', required ? { require: required } : {}),
  version: () => getTransport().call('system.version', {}),
  schema: () => getTransport().call('system.schema', {}),
};

let readiness: SystemReadiness | undefined;
const readinessHandlers = new Set<(value: SystemReadiness) => void>();

export async function bootstrapBackend(): Promise<SystemReadiness> {
  await systemApi.ping();
  readiness = await systemApi.readiness();
  for (const handler of readinessHandlers) handler(readiness);
  return readiness;
}

export function getReadiness(): SystemReadiness | undefined {
  return readiness;
}

export function onReadiness(handler: (value: SystemReadiness) => void): () => void {
  readinessHandlers.add(handler);
  if (readiness) queueMicrotask(() => handler(readiness!));
  return () => readinessHandlers.delete(handler);
}

export function findCapability(readiness: SystemReadiness | undefined, capabilityId: string) {
  return readiness?.capabilities.find((capability) => capability.capability_id === capabilityId);
}
