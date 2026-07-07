/**
 * 方向 E · 文件操作观测接口（read / write / create · 读 / 写 / 建）。
 *
 * 这是**前端（E）自己的消费视图**，不是新契约：Agent 在开发过程中读写、创建文件的
 * 能力由后端提供，E 只负责“观测 + 呈现 + 接住人机确认”。各字段严格锚定上游真实实现：
 *
 *  - 方向 A（acp-client-prototype）
 *      · `src/client-methods/filesystem-handler.ts` —— ACP 文件方法：
 *        `fs/read_text_file` {path}→{content} / `fs/write_text_file` {path,content}→{} /
 *        `fs/list_directory` {path}→{entries}。注意：**没有独立的 create**，
 *        `write_text_file` 内部 `mkdir -p` + 写入，故“创建”= 首次写入。
 *      · `src/client-methods/permission-handler.ts` —— `session/request_permission`
 *        {title,message,options[]} → {outcome:{outcome:'selected',optionId}}。
 *      · `src/driver/interface.ts` —— `DriverToolEvent`（工具事件流，见 ./driver 镜像）。
 *  - 方向 C（newide-scaffold `src/core/*`）：`FileLease`（授权）、`ArtifactRef`（patch/diff 产物）。
 *  - 方向 D（newide-scaffold `src/gate/*`）：`GateDecision`（allow/deny/ask/defer）。
 *
 * 边界（务必守住）：E **不执行**文件读写、**不强制**租约、**不判定** Gate —— 这些是 A/C/D 的后端职责。
 * 本文件里出现的 lease/gate/artifact 字段都是“后端给出的既成事实”，E 仅据此渲染。
 */

import type { ArtifactRef, LeaseId, LeaseScope, SchemaVersion, TaskId, Timestamp } from './core';
import type { GateDecision } from './gate';
import type { DriverToolEvent } from './driver';

// ── A · ACP 文件方法（对齐 filesystem-handler.ts 的 switch 分支） ──

/** Agent 通过 ACP 客户端真正调用的文件方法名 —— 后端能力面的唯一真相。 */
export type AcpFsMethod = 'fs/read_text_file' | 'fs/write_text_file' | 'fs/list_directory';

/**
 * 每个 ACP 文件方法所需的租约范围（read/write · 读/写）。
 *
 * 这是编译期护栏落点之一：若 A 增删/改名文件方法，或 C 改动 `LeaseScope`，
 * 这张表会缺键/目标非法而 `tsc` 报错，把上游漂移咬在 E 这一侧。
 * 与 `map.ts` 的桥接层同源同用途（勿变死代码，需被真实引用）。
 */
export const ACP_FS_METHOD_SCOPE: Record<AcpFsMethod, LeaseScope> = {
  'fs/read_text_file': 'read',
  'fs/list_directory': 'read',
  'fs/write_text_file': 'write',
};

/**
 * E 侧展示语义（English canonical + 中文注解）。
 * `create` 是 **E 自行推导的展示细分**（写入一个树中尚不存在的路径），
 * 后端并无独立 create 方法 —— 见文件头说明。不得作为对后端的诉求。
 */
export type FileOpIntent =
  | 'read' //  读取 · fs/read_text_file
  | 'write' // 写入(改) · fs/write_text_file 命中已存在路径
  | 'create' // 创建 · fs/write_text_file 命中新路径（E 推导）
  | 'list'; // 列目录 · fs/list_directory

// ── A · 权限请求镜像（对齐 permission-handler.ts） ──

/** `session/request_permission` 的单个可选项（A 原样透传 optionId + 展示名）。 */
export interface FilePermissionOption {
  optionId: string;
  name: string;
}

/** 文件写入前 A 发起的权限请求（人机确认弹窗的数据源）。 */
export interface FilePermissionPrompt {
  title: string;
  message?: string;
  options: FilePermissionOption[];
}

/** 人做出选择后回给 A 的结果（对齐 handle() 返回的 outcome 结构）。 */
export interface FilePermissionOutcome {
  outcome: 'selected' | 'cancelled';
  optionId?: string;
}

// ── E · 文件操作观测视图（渲染时间线/审计所需的编织结果） ──

/**
 * 一次文件操作在 E 侧的观测视图 —— 把 A 的工具事件/权限、C 的租约/产物、D 的 Gate 决策
 * 收拢成一条可渲染记录。全部字段来自后端既成事实，E 只读。
 */
export interface FileOpObservation {
  /** 关联的工具事件（来自 A 的 `DriverToolEvent.tool_event_id`）。 */
  tool_event_id: DriverToolEvent['tool_event_id'];
  /** Agent 实际调用的 ACP 方法（A）。 */
  method: AcpFsMethod;
  /** E 推导的展示语义（read/write/create/list）。 */
  intent: FileOpIntent;
  /** 目标路径（ACP 方法的 `path` 入参）。 */
  path: string;
  /**
   * 写入内容（`fs/write_text_file` 的 `content` 入参，A）。仅写/建操作携带。
   * 真后端下由 A 执行写入、E 只观测；mock 演示里由桌面壳代 A 落盘到本机工作区，
   * 使"agent 生成的文件"成为可见的既成事实 —— 这不改变 E 不执行的边界立场。
   */
  content?: string;
  /** 该方法所需租约范围，恒等于 `ACP_FS_METHOD_SCOPE[method]`。 */
  required_scope: LeaseScope;
  /** 覆盖此次操作的 `FileLease`（C 授权，F 只显示）。缺失表示未观测到对应租约。 */
  lease_id?: LeaseId;
  /** 若写入前触发了权限请求（A）。 */
  permission?: FilePermissionPrompt;
  /** 人机确认结果（E 收集后回传 A）。 */
  permission_outcome?: FilePermissionOutcome;
  /** 若该操作经过 Gate（D）给出的放行判定；`ask` 即需要人介入。 */
  gate_decision?: GateDecision;
  /** 工具事件状态（A `DriverToolEvent.status`）。 */
  status: DriverToolEvent['status'];
  /** 写/建操作登记的产物（C，通常是 patch/diff）。 */
  artifact_ref?: ArtifactRef;
  /** 一句话摘要（A `DriverToolEvent.summary`，用于列表展示）。 */
  summary: string;
  task_id?: TaskId;
  created_at: Timestamp;
  schema_version: SchemaVersion;
}
