/**
 * 方向 E · API client —— 前端到后端的第一条真实调用链（N2 创建 Task）。
 *
 * 契约锚点：`TaskCreateRequest` → `Task`（api/需求到处理-全流程图与状态机.md
 * N2 行，🟢 frozen；实体形状见 ./types/coord.ts，对齐 BCD core/task.ts）。
 *
 * 路由说明：后端契约冻结的是**实体形状**，HTTP 路由路径尚未发布。
 * `POST /tasks` 是 E 侧暂定约定，集中在本文件（TASKS_PATH），后端定稿后一处改。
 *
 * Mock 边界：`apiConfig.useMock`（默认 true）时不发网络请求，本地伪造一个
 * 与后端受理行为同形的 `Task`（status='created'）走完同一条代码路径 ——
 * 调用方无需感知 mock 与否。
 */
import { apiConfig } from './config';
import { emitLocalEvent } from './events';
import { SCHEMA_VERSION } from './types';
import type { Task, TaskCreateRequest } from './types';

const TASKS_PATH = '/tasks';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function postJson<TReq, TRes>(path: string, body: TReq): Promise<TRes> {
  let res: Response;
  try {
    res = await fetch(`${apiConfig.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new ApiError(
      `POST ${path} 网络失败: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    throw new ApiError(`POST ${path} 返回 ${res.status}`, res.status);
  }
  return (await res.json()) as TRes;
}

let mockSeq = 0;

/** 伪造后端受理结果：与 C 端 N2 行为同形（status='created'，回填服务端字段）。 */
function mockCreatedTask(req: TaskCreateRequest): Task {
  const now = new Date().toISOString();
  return {
    task_id: `task-${Date.now().toString(36)}-${(mockSeq++).toString(36)}`,
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
  };
}

/** N2 创建 Task：把需求提交给协调器（C），返回权威 `Task`。 */
export async function createTask(req: TaskCreateRequest): Promise<Task> {
  if (apiConfig.useMock) {
    const task = mockCreatedTask(req);
    // 后端 N2 受理即 emit task.created（全流程图 N2 行）；mock 同形复现，
    // 让事件通道的消费链路在无后端时也真实走通。
    emitLocalEvent({
      event_id: `evt-${task.task_id}`,
      event_type: 'task.created',
      subject_id: task.task_id,
      task_id: task.task_id,
      payload: { status: task.status },
      created_at: task.created_at,
      schema_version: SCHEMA_VERSION,
    });
    return task;
  }
  return postJson<TaskCreateRequest, Task>(TASKS_PATH, req);
}
