import methods from '@rpc-methods';
import type { RpcMethod } from './types/rpc';

export const RPC_METHODS = methods as RpcMethod[];
export const RPC_METHOD_SET: ReadonlySet<RpcMethod> = new Set(RPC_METHODS);
