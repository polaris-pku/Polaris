/**
 * agent 工作区绑定。
 *
 * BCD 只在**启动时**读一次 `ACP_WORKSPACE` —— 也就是说「agent 写到哪」是后端的**全局状态**，
 * 不跟着任务走。任何一次 re-configure（切项目、别的进程、手动重启）都会改变下一个 run 的落点，
 * 而界面上完全看不出来：需求照样跑完、照样显示 completed，文件却写进了别的项目目录。
 *
 * 所以规则是：**提交需求之前，先把后端工作区对齐到当前项目**。
 * 主进程侧对相同配置做了去重（见 electron/backendBridge.cjs 的 start），
 * 所以重复调用不会引起无谓的重启。
 */
import type { Project } from '@/types';

/**
 * 把 agent 工作区绑到某个项目，并等后端就绪。
 * 浏览器里没有桌面桥（mock 模式）→ 静默跳过。
 * 返回 false 表示绑定失败（后端起不来），调用方应据此判断要不要继续提交。
 */
export async function bindBackendWorkspace(project: Project | undefined): Promise<boolean> {
  const backend = window.desktop?.backend;
  if (!backend || !project) return false;
  try {
    const status = await backend.configure({
      projectName: project.name,
      rootPath: project.rootPath,
    });
    return status.state !== 'error';
  } catch (err) {
    console.warn('[backend] 绑定 agent 工作区失败：', err);
    return false;
  }
}
