import { getTransport } from './transport';
import type { ResetDriverRoutingInput, UpdateDriverRoutingInput } from './types/driverRouting';

export const driverApi = {
  getConfig: () => getTransport().call('driver.getConfig', {}),
  updateRouting: (input: UpdateDriverRoutingInput) =>
    getTransport().call('driver.updateRouting', input),
  resetRouting: (input: ResetDriverRoutingInput) =>
    getTransport().call('driver.resetRouting', input),
};
