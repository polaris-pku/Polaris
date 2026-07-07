import type { FileOpObservation } from '@/api/types';
import type { FileNode } from '@/types';

/**
 * E 侧落盘适配层：把获准的 agent 写操作交给桌面壳真正写入本机工作区。
 *
 * 真后端下文件写入由 A（Driver/ACP 客户端）执行，E 只观测；mock 演示里
 * 桌面壳（electron/fsBridge.cjs）代 A 落盘，语义与 A 的 `fs/write_text_file`
 * 一致（mkdir -p + 覆盖写）。浏览器环境没有桥，落盘按 skipped 记录。
 */

/** 一次落盘的结果（keyed by tool_event_id，存 store.agentFileWrites 供面板展示）。 */
export type AgentFileWriteResult =
  | { status: 'pending' }
  | { status: 'written'; absPath: string }
  | { status: 'failed'; error: string }
  | { status: 'skipped'; reason: string };

/** 写入目标：rootPath 为用户自选的项目根目录，缺省落默认工作区/<projectName>/。 */
export type AgentWriteTarget = {
  projectName: string;
  rootPath?: string;
};

/** 把一条写操作的生成内容写入项目根目录；返回可渲染的落盘结果。 */
export async function writeAgentFile(
  op: FileOpObservation,
  target: AgentWriteTarget,
): Promise<AgentFileWriteResult> {
  const bridge = window.desktop?.fs;
  if (!bridge) return { status: 'skipped', reason: '浏览器环境无落盘能力（桌面版可写入）' };
  try {
    const res = await bridge.writeTextFile({
      projectName: target.projectName,
      rootPath: target.rootPath,
      path: op.path,
      content: op.content ?? '',
    });
    return res.ok
      ? { status: 'written', absPath: res.absPath }
      : { status: 'failed', error: res.error };
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}

/** 文件预览的读取结果。 */
export type ProjectFileReadResult =
  | { ok: true; content: string; absPath: string }
  | { ok: false; error: string };

/** 读取项目内文本文件供预览（与写入同一目标解析）。浏览器环境直接报不可用。 */
export async function readProjectTextFile(
  target: AgentWriteTarget,
  relPath: string,
): Promise<ProjectFileReadResult> {
  const bridge = window.desktop?.fs;
  if (!bridge) return { ok: false, error: '浏览器环境无法读取本机文件（桌面版可用）' };
  try {
    return await bridge.readTextFile({
      projectName: target.projectName,
      rootPath: target.rootPath,
      path: relPath,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 弹出原生目录选择器（选择即授权该目录读写）。非桌面或取消返回 null。 */
export async function pickProjectDirectory(title?: string): Promise<DesktopChosenDirectory | null> {
  const bridge = window.desktop?.fs;
  if (!bridge) return null;
  return bridge.chooseDirectory(title ? { title } : undefined);
}

/** 把已授权目录扫描为 FileNode 树（打开磁盘项目用）。 */
export async function readProjectFolder(
  rootPath: string,
): Promise<{ tree: FileNode[]; truncated: boolean } | { error: string }> {
  const bridge = window.desktop?.fs;
  if (!bridge) return { error: '浏览器环境无法读取本机目录（桌面版可用）' };
  const res = await bridge.readDirectoryTree(rootPath);
  return res.ok ? { tree: res.tree as FileNode[], truncated: res.truncated } : { error: res.error };
}

/** 在系统文件管理器中定位已落盘的文件（仅桌面版有效）。 */
export function revealAgentFile(absPath: string): void {
  void window.desktop?.fs.reveal(absPath);
}
