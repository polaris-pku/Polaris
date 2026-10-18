import { getTransport } from './transport';
import type {
  DriverProbeParams,
  ResetDriverRoutingInput,
  UpdateDriverRoutingInput,
} from './types/driverRouting';

export const driverApi = {
  getConfig: () => getTransport().call('driver.getConfig', {}),
  refresh: (params: DriverProbeParams = { force: true }) =>
    getTransport().call('driver.refresh', params),
  list: (params: DriverProbeParams = {}) => getTransport().call('driver.list', params),
  probe: (params: DriverProbeParams = {}) => getTransport().call('driver.probe', params),
  updateRouting: (input: UpdateDriverRoutingInput) =>
    getTransport().call('driver.updateRouting', input),
  resetRouting: (input: ResetDriverRoutingInput) =>
    getTransport().call('driver.resetRouting', input),
};
