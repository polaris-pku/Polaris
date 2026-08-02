/**
 * 方向 E · API client —— 前端到 BCD 后端的真实调用链。
 *
 * 传输见 ./transport.ts（桌面壳 = Electron IPC → BCD 的 stdio JSON-RPC；浏览器 = mock）。
 *
 * ── 契约错位（重要）──
 * 前端的 `TaskCreateRequest` 有 spec / completion_criteria / role_id / risk_level /
 * budget / affected_paths；而后端 `run.create` **只收 `{prompt, mode?}`**
 * （project_id / client_task_id / title 虽然通过校验，但当前 runner 直接忽略）。
 * 收敛发生在 ./map.ts 的 `toRunCreateParams()` —— 那里是**唯一**的收敛点：
 * 后端将来接受更丰富的入参时只改那一个函数。前端未被接受的字段仍保留在本地状态里。
 *
 * ── 一个语义差异 ──
 * 后端没有「只建 Task 不建 Run」的入口：`run.create` 一次性建 Task + Run 并**立刻开跑**。
 * 所以前端的 N2「创建 Task」在真实链路上等价于「创建 Task 并启动 Run」。
 */
import { toRunCreateParams } from './map';
import { getTransport } from './transport';
import { SCHEMA_VERSION } from './types';
import type { Task, TaskCreateRequest } from './types';
import type { RunCreateResult, RunMode, RunSnapshot } from './types/rpc';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 后端受理结果 + 前端本地补全的展示字段。 */
export interface CreatedRun {
  run_id: string;
  task_id: string;
  /** 后端权威 task_id + 前端提交的内容拼出的 Task（后端未接受的字段保留本地值）。 */
  task: Task;
}

export interface CreateRunOptions {
  mode?: RunMode;
  projectId?: string;
  clientTaskId?: string;
  title?: string;
  workspacePath?: string;
}

/**
 * N2/N3 创建 Task 并启动 Run。
 *
 * 后端只接受 `prompt`；其余字段（验收标准 / 风险 / 预算…）当前后端不收，
 * 前端原样保留在返回的 `task` 里，等后端契约放开后自然生效。
 */
export async function createRun(
  req: TaskCreateRequest,
  options: CreateRunOptions = {},
): Promise<CreatedRun> {
  let created: RunCreateResult;
  try {
    const params = toRunCreateParams(req, options);
    created = await getTransport().call('run.create', params);
  } catch (err) {
    throw new ApiError(`run.create 失败: ${errText(err)}`, codeOf(err));
  }

  const now = new Date().toISOString();
  return {
    run_id: created.run_id,
    task_id: created.task_id,
    task: {
      task_id: created.task_id,
      parent_id: req.parent_task_id,
      status: 'created',
      role_id: req.role_id,
      risk_level: req.risk_level ?? 'medium',
      spec: req.spec,
      completion_criteria: req.completion_criteria,
      affected_paths: req.affected_paths,
      budget: req.budget,
      created_at: now,
      updated_at: now,
      schema_version: SCHEMA_VERSION,
    },
  };
}

/** 拉取 run 完整快照。形状是双态的 —— 消费前用 `isFrontendWorkflowV01` 守卫。 */
export async function getRunSnapshot(runId: string): Promise<RunSnapshot> {
  try {
    return await getTransport().call('run.getSnapshot', { run_id: runId });
  } catch (err) {
    throw new ApiError(`run.getSnapshot 失败: ${errText(err)}`, codeOf(err));
  }
}

/** 取消 run。注意：对已终态的 run，后端抛的是通用 -32603 而非有类型的错误。 */
export async function cancelRun(runId: string): Promise<void> {
  try {
    await getTransport().call('run.cancel', { run_id: runId });
  } catch (err) {
    throw new ApiError(`run.cancel 失败: ${errText(err)}`, codeOf(err));
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function codeOf(err: unknown): number | undefined {
  return err && typeof err === 'object' && 'code' in err
    ? (err as { code?: number }).code
    : undefined;
}
