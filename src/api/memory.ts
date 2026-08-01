import { getTransport } from './transport';

export const memoryApi = {
  getCapabilities: () => getTransport().call('memory.getCapabilities', {}),
  listAgents: () => getTransport().call('memory.listAgents', {}),
  getAgent: (roleId: string) => getTransport().call('memory.getAgent', { role_id: roleId }),
  listSkills: (roleId: string) => getTransport().call('memory.listSkills', { role_id: roleId }),
  listExperiences: (roleId: string) =>
    getTransport().call('memory.listExperiences', { role_id: roleId }),
  listMaintenance: (roleId?: string) =>
    getTransport().call('memory.listMaintenance', roleId ? { role_id: roleId } : {}),
  promoteSkills: (roleId: string, requestedBy?: string) =>
    getTransport().call('memory.promoteSkills', {
      role_id: roleId,
      ...(requestedBy ? { requested_by: requestedBy } : {}),
    }),
};
