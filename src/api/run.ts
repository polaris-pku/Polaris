import { getTransport } from './transport';
import type { RunCreateParams } from './types/rpc';
import type { RunGetEventsParams, RunGetUsageParams } from './types/observability';

export const runApi = {
  create: (params: RunCreateParams) => getTransport().call('run.create', params),
  getSnapshot: (runId: string) => getTransport().call('run.getSnapshot', { run_id: runId }),
  getEvents: (runId: string, options: Omit<RunGetEventsParams, 'run_id'> = {}) =>
    getTransport().call('run.getEvents', { run_id: runId, ...options }),
  getPayload: (runId: string, payloadRef: string) =>
    getTransport().call('run.getPayload', { run_id: runId, payload_ref: payloadRef }),
  getUsage: (params: RunGetUsageParams) => getTransport().call('run.getUsage', params),
  list: () => getTransport().call('run.list', {}),
  cancel: (runId: string) => getTransport().call('run.cancel', { run_id: runId }),
  restart: (runId: string) => getTransport().call('run.restart', { run_id: runId }),
  subscribe: (runId: string, afterSequence?: number) =>
    getTransport().call('run.subscribe', {
      run_id: runId,
      ...(afterSequence !== undefined ? { after_sequence: afterSequence } : {}),
    }),
  unsubscribe: (runId: string) => getTransport().call('run.unsubscribe', { run_id: runId }),
};
