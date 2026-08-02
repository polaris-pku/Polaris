export type CapabilityState = 'available' | 'degraded' | 'unavailable';

export interface ProviderIdentity {
  provider_id: string;
  version?: string;
  mode?: string;
}

export interface ComponentStatus {
  component_id: string;
  status: 'ready' | 'degraded' | 'unavailable';
  provider?: ProviderIdentity;
  reason_code?: string;
  reason?: string;
}

export interface CapabilityStatus {
  capability_id: string;
  status: CapabilityState;
  provider?: ProviderIdentity;
  reason_code?: string;
  reason?: string;
  limitations?: string[];
}

export interface PingResult {
  status: 'ok';
  protocol_version: string;
}

export interface SystemLiveness {
  contract_version: string;
  status: 'alive';
  generated_at: string;
}

export interface SystemReadiness {
  contract_version: string;
  schema_version: string;
  protocol_version: string;
  service: { status: 'operational' | 'partial' | 'unavailable' };
  core_required_capabilities: string[];
  components: ComponentStatus[];
  capabilities: CapabilityStatus[];
  generated_at: string;
}

export interface SystemCapabilities {
  contract_version: string;
  capabilities: CapabilityStatus[];
  generated_at: string;
}

export interface SystemVersion {
  contract_version: string;
  package_name: string;
  package_version: string;
  protocol_version: string;
  schema_version: string;
  build_commit: string;
  runtime_node_version: string;
}

export interface SystemSchemaManifest {
  contract_version: string;
  schema_id: 'newide.system';
  schema_version: string;
  protocol_version: string;
  methods: string[];
  capability_ids: string[];
  sha256: string;
}
