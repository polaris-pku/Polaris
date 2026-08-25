/**
 * 制品正文读取契约 —— 对齐 BCD `src/rpc/artifact-methods.ts` 与
 * `src/app/run-artifact-content-reader.ts`（newide-scaffold）。
 *
 * `artifact.getContent` 是唯一一条能把 artifact_id 换成正文的通道。它没有 offset /
 * cursor / range 参数，单次响应正文上限 1 MiB，超过就从**字节**处截断并把 `truncated`
 * 置 true —— 想看完整内容只能重读一遍，读到的还是同样被截断的前 1 MiB。
 *
 * 旧后端（本方法尚未注册时）会回 -32601 Method not found；调用方应把它当作
 * 「后端太旧」降级处理，而不是当成制品不存在。
 */

import type { ArtifactId, RunId } from './core';

/**
 * `artifact.getContent` 入参。两个字段都必填，且都必须匹配 /^[A-Za-z0-9_-]+$/ ——
 * 后端 schema 是 .strict()，多传一个键就是 -32602 Invalid params。
 */
export interface ArtifactGetContentParams {
  run_id: RunId;
  artifact_id: ArtifactId;
}

/**
 * `artifact.getContent` 返回体，逐字段对齐后端 `RunArtifactContent`（9 个字段，
 * 只有 `target_path` 可选，且缺失时整个键不出现，不会是 null）。
 */
export interface ArtifactContentResult {
  /** 原样回显请求里的 run_id，不是后端重新推导出来的。 */
  run_id: RunId;
  artifact_id: ArtifactId;
  /**
   * 来自 ArtifactRef.type，取值通常落在 ./core 的 `ArtifactType` 里，
   * 但后端这里声明的是裸 string，没有收紧 —— 别做穷尽 switch。
   */
  type: string;
  /** 缺省值是字面量 'text/plain; charset=utf-8'（带 charset 后缀）。 */
  media_type: string;
  /** 制品要落到工作区的哪个路径；后端只在有值时才带这个键。 */
  target_path?: string;
  /**
   * 存储里记的摘要，后端不校验；取不到才现算。现算走的是**完整**字节，
   * 所以 `truncated` 为 true 时这个值和 `content` 对不上，不要拿它去校验正文。
   */
  sha256: string;
  /**
   * 正文（UTF-8 解码后）。截断是先切字节再解码的，跨界的多字节字符会解成 U+FFFD，
   * 所以被截断时最后一个字符不可信。
   */
  content: string;
  /** 制品的**完整**字节数，不是 `content` 的长度 —— 用它渲染「共 N 字节，已截断」。 */
  bytes_total: number;
  truncated: boolean;
}

/**
 * 单次响应正文上限：1 MiB。判定是严格大于，正好 1048576 字节时 `truncated` 仍为 false。
 * 上限在 reader 层，不在 RPC 层，所以换任何入口都是这个值。
 */
export const ARTIFACT_CONTENT_MAX_BYTES = 1024 * 1024;

/**
 * JSON-RPC 错误码：run 目录不存在，或该 run 的 stage 状态里找不到这个 artifact_id。
 * 两种情况在协议层不可区分 —— 这个方法没有单独的 RUN_NOT_FOUND。
 */
export const ARTIFACT_NOT_FOUND_CODE = -32015;

/** JSON-RPC 错误码：制品存在，但正文读不出来（无正文 / metadata 制品 / 引用坏了 / 文件读失败）。 */
export const ARTIFACT_CONTENT_UNAVAILABLE_CODE = -32016;

/**
 * 上面两个错误码的 `data` 载荷（`BackendError.data`）。
 * `reason` 只有 ARTIFACT_CONTENT_UNAVAILABLE 才带，且是后端异常的自由文本 ——
 * 只能当诊断信息原样展示，不要拿它做分支判断。
 */
export interface ArtifactContentErrorData {
  run_id: RunId;
  artifact_id: ArtifactId;
  reason?: string;
}
