import { getTransport } from './transport';
import type { RunCreateParams } from './types/rpc';

export const runApi = {
  create: (params: RunCreateParams) => getTransport().call('run.create', params),
  getSnapshot: (runId: string) => getTransport().call('run.getSnapshot', { run_id: runId }),
  list: () => getTransport().call('run.list', {}),
  cancel: (runId: string) => getTransport().call('run.cancel', { run_id: runId }),
  restart: (runId: string) => getTransport().call('run.restart', { run_id: runId }),
  subscribe: (runId: string) => getTransport().call('run.subscribe', { run_id: runId }),
  unsubscribe: (runId: string) => getTransport().call('run.unsubscribe', { run_id: runId }),
};
