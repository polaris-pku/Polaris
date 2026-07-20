/**
 * Python 运行时的渲染层视图 —— **模块级缓存 + useSyncExternalStore，不进 zustand。**
 *
 * ── 为什么不进 store ──
 * `resetDemo()` 是 `set(blankState())`（见 store/slices/executionSlice.ts）。一个天真的实现会把
 * 「已安装的 Python 清单」和「用户选中的解释器」一起放进 store，于是用户点一下「重来一次」，
 * 他刚装好的 260 MB Python 就从界面上消失了 —— 而它明明还在磁盘上。
 *
 * 真值源是**主进程 + settings.json**，不是渲染层。这里只是一份缓存：
 * 挂载时用 `py:getState` 拉一次（补齐早于订阅到达的进度事件），之后跟着 `py:event` 走。
 */
import { useSyncExternalStore } from 'react';

const EMPTY: PyState = { runtimes: [], selectedId: null, install: null, catalog: [] };

let state: PyState = EMPTY;
const listeners = new Set<() => void>();
let attached = false;

/** 桌面桥在不在。浏览器里 `window.desktop` 是 undefined —— 不做假的降级，如实告诉用户。 */
export function pythonAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.desktop?.python;
}

function bridge() {
  return typeof window === 'undefined' ? undefined : window.desktop?.python;
}

function publish(next: PyState) {
  state = next;
  listeners.forEach((l) => {
    l();
  });
}

/**
 * 订阅一次主进程的进度推送（幂等）。
 * 照 src/api/events.ts 的模块级 attach() —— 组件挂了又卸不该重复挂监听器。
 */
function attach() {
  if (attached) return;
  attached = true;
  const api = bridge();
  if (!api) return;

  api.onEvent((event) => {
    // 进度事件只更新 install 这一格；runtimes 要等主进程重建完再拉（done 时）
    publish({ ...state, install: event });
    if (event.phase === 'done') void refreshPythonState();
  });
  void refreshPythonState();
}

/** React 订阅入口。 */
export function usePythonState(): PyState {
  return useSyncExternalStore(
    (onChange) => {
      attach();
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    getPythonState,
    getPythonState, // 服务端/预渲染没有桌面桥，返回同一个空快照即可
  );
}

/** 非 React 处取当前快照（引用稳定：没变过就是同一个对象）。 */
export function getPythonState(): PyState {
  return state;
}

/**
 * 当前选中的解释器 id。
 * **没有解释器时是 null，不是「随便挑一个能跑的」** —— 静默回落会让用户在不知情的情况下
 * 用另一个 Python 跑他的代码（依赖装在哪个环境里，他自己都说不清）。
 */
export function getSelectedRuntimeId(): string | null {
  return state.selectedId;
}

export function selectedRuntime(s: PyState): PyRuntime | null {
  return s.runtimes.find((r) => r.id === s.selectedId) ?? null;
}

/** 从主进程拉一次完整快照。 */
export async function refreshPythonState(): Promise<void> {
  const api = bridge();
  if (!api) {
    publish(EMPTY);
    return;
  }
  publish(await api.getState());
}

/**
 * 「用户自己按了取消」的哨兵，与 electron/pythonBridge.cjs 里的 CANCELED 一致。
 * 取消走的是 {ok:false} 这条返回（IPC 形状是冻结的），但它**不是失败**，不该渲染成红色错误行。
 */
const CANCELED = '已取消';

/** 本地把安装态标成失败 —— 主进程在「参数不合法」这类早退路径上不会推 py:event。 */
function failLocally(catalogId: string, error: string) {
  publish({ ...state, install: { catalogId, phase: 'error', percent: 0, message: error } });
}

export async function selectRuntime(id: string): Promise<void> {
  const api = bridge();
  if (!api) return;
  const result = await api.select(id);
  if (result.ok) await refreshPythonState();
}

/**
 * 一键安装。进度走 py:event，失败原因**必须落到界面上** ——
 * 尤其「校验失败」：它可能真的是中间人，不能被吞掉。
 */
export async function installRuntime(catalogId: string): Promise<void> {
  const api = bridge();
  if (!api) return;
  const result = await api.install(catalogId);
  if (!result.ok && result.error !== CANCELED) failLocally(catalogId, result.error);
  await refreshPythonState();
}

export async function cancelInstall(): Promise<void> {
  const api = bridge();
  if (!api) return;
  await api.cancelInstall();
  await refreshPythonState();
}

export async function uninstallRuntime(id: string): Promise<void> {
  const api = bridge();
  if (!api) return;
  await api.uninstall(id);
  await refreshPythonState();
}

/**
 * 手动指定解释器 —— 只能请求主进程弹一个**原生**文件对话框。
 *
 * 渲染层永远无法传一个解释器路径字符串过去（不变量 I2）：**原生选择动作 = 授权动作**，
 * 与 fs:chooseDirectory 完全同构。用户取消 → `{ok:true}`，不是错误。
 */
export async function pickInterpreter(): Promise<{ ok: boolean; error?: string }> {
  const api = bridge();
  if (!api) return { ok: false, error: '仅桌面版可用' };
  const result = await api.pickInterpreter();
  await refreshPythonState();
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/** 测试用：清空模块级缓存。 */
export function resetPythonRuntimeCache(): void {
  state = EMPTY;
  attached = false;
  listeners.clear();
}
