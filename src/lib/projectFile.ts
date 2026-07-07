import type { ProjectTrace } from '@/store/useDemoStore';

/**
 * Agent 执行 trace 的存盘工具。
 * 桌面版：经 fs 桥写进项目根目录的 `.hci/`（点号目录，扫描文件树时自动隐藏）；
 * 浏览器：回退为下载 .json。trace 是只读审计快照，不支持导回应用。
 */

/** 触发浏览器/Electron 下载，把数据存成 .json 文件到磁盘。 */
export function downloadJson(filename: string, data: unknown): void {
  const text = JSON.stringify(data, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** trace 文件名：<项目名>-trace-<时间戳>.json（文件名安全化）。 */
export function traceFileName(projectName: string, savedAt: string): string {
  const safe = projectName.trim().replace(/[\\/:*?"<>|]+/g, '_') || 'project';
  const ts = savedAt.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  return `${safe}-trace-${ts}.json`;
}

/** 保存 trace 的结果（供 UI 提示）。 */
export type TraceSaveResult =
  | { ok: true; where: 'disk'; absPath: string }
  | { ok: true; where: 'download'; filename: string }
  | { ok: false; error: string };

/**
 * 把执行 trace 落盘：桌面版写入项目根目录 `.hci/<文件名>`（默认工作区或已授权自定义目录），
 * 浏览器环境回退为下载。
 */
export async function saveProjectTrace(trace: ProjectTrace): Promise<TraceSaveResult> {
  const filename = traceFileName(trace.project.name, trace.savedAt);
  const bridge = window.desktop?.fs;
  if (!bridge) {
    downloadJson(filename, trace);
    return { ok: true, where: 'download', filename };
  }
  const res = await bridge.writeTextFile({
    projectName: trace.project.name,
    rootPath: trace.project.rootPath,
    path: `.hci/${filename}`,
    content: JSON.stringify(trace, null, 2),
  });
  return res.ok
    ? { ok: true, where: 'disk', absPath: res.absPath }
    : { ok: false, error: res.error };
}
