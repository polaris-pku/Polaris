import { getTransport } from './transport';

/**
 * 制品正文读取 —— 全后端唯一一条能把 artifact_id 换成正文的通道。
 *
 * 单次响应正文上限 1 MiB，且**没有 offset / cursor / range 参数**：截断之后只能重读，
 * 读到的还是同一段前 1 MiB。所以调用方必须把 `truncated` 如实告诉用户，不能装作读全了。
 *
 * 错误码（-32015 找不到 / -32016 正文不可读 / -32601 后端太旧）不在这里翻译 ——
 * facade 只做 wire 名到 camelCase 的映射，让 BackendError 原样抛给调用方。
 */
export const artifactApi = {
  getContent: (runId: string, artifactId: string) =>
    getTransport().call('artifact.getContent', { run_id: runId, artifact_id: artifactId }),
};
