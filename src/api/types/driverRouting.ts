export interface DriverRoutingDriver {
  driver_id: string;
  agent: string;
  display_name?: string;
  description?: string;
  selectable: boolean;
  status: 'configured' | 'degraded' | 'unavailable';
  reason_code?: string;
  limitations?: string[];
}

export interface DriverRoutingRole {
  role_id: string;
  driver_id: string;
  effective_driver_id: string;
  source: 'default' | 'role_override';
  known_role: boolean;
}

export interface DriverRoutingSnapshot {
  schema_version: 'driver-routing.v1';
  revision: string;
  scope: 'project';
  default_driver: string;
  drivers: DriverRoutingDriver[];
  roles: DriverRoutingRole[];
  orphan_roles: DriverRoutingRole[];
}

export interface UpdateDriverRoutingInput {
  expected_revision: string;
  default_driver: string;
  roles: Record<string, string>;
}

export interface ResetDriverRoutingInput {
  expected_revision: string;
}

export interface DriverProbeParams {
  agent_ids?: string[];
  timeout_ms?: number;
  concurrency?: number;
  force?: boolean;
}

export interface DriverProbeResult {
  schema_version: 'driver-probe.v1';
  generated_at: string;
  drivers: Array<{
    agentId: string;
    displayName: string;
    launch: { command: string; args: string[] };
    provenance: 'env-override' | 'local-entry' | 'path' | 'npx-on-demand';
    connectionType: 'acp' | 'pty';
    initialize?: {
      protocolVersion: number;
      authMethods: number;
      agentVersion?: string;
      agentCapabilities?: string[];
    };
    probedAt: string;
  }>;
}
