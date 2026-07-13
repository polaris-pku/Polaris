/**
 * Python 运行时面板的文案与数字格式化 —— 纯函数，无 IO，可测。
 *
 * 为什么这些字符串值得单独一个模块：安装是**唯一一处用户要盯着看几十秒**的地方。
 * 「卡在 60%」时他唯一需要知道的是「卡在下载还是解包」——
 * 所以相位名必须是文字，不能是一个转圈的 spinner。
 */

/**
 * 人类可读的字节数。
 *
 * 100 MB 以下保留 1 位小数（`28.0 MB` —— 下载进度里 0.1 MB 的跳动就是「它还在动」的证据），
 * 100 MB 以上取整（`248 MB` —— 谁也不关心一个安装包是 248.3 还是 248.4）。
 */
export function formatBytes(bytes: number): string {
  const n = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;

  if (n < KB) return `${String(Math.round(n))} B`;
  if (n < MB) return `${String(Math.round(n / KB))} KB`;
  if (n < GB) {
    const mb = n / MB;
    return mb >= 100 ? `${String(Math.round(mb))} MB` : `${mb.toFixed(1)} MB`;
  }
  return `${(n / GB).toFixed(2)} GB`;
}

/** `12.4 / 28.0 MB` —— 同一单位只写一次，两个数才好比大小。 */
export function formatDownloadProgress(received: number, total: number): string {
  if (!(total > 0)) return formatBytes(received);
  const done = formatBytes(received);
  const all = formatBytes(total);
  const unit = all.slice(all.indexOf(' ') + 1);
  const doneUnit = done.slice(done.indexOf(' ') + 1);
  // 单位不同（如 890 KB / 28.0 MB）就各写各的，别为了对齐把 KB 硬说成 0.9 MB
  return doneUnit === unit ? `${done.slice(0, done.indexOf(' '))} / ${all}` : `${done} / ${all}`;
}

/** 千分位。解包时的条目数是四位数，不分隔就读不出量级。 */
function group(n: number): string {
  return Math.max(0, Math.round(n)).toLocaleString('en-US');
}

/** 一次安装的进度快照（PyEvent 的字段是冻结契约，这里只读它已有的那几个）。 */
export type PyProgress = PyInstallState & {
  receivedBytes?: number;
  totalBytes?: number;
  entries?: number;
};

/**
 * 相位文案。**每一相都有名字**，因为「它卡住了」时用户第一个要问的就是「卡在哪一步」。
 *
 * 解包相位只报「已解条目数 + 百分比」而不报分母：PyEvent 里没有「总条目数」这个字段，
 * 而为了一个分母去偷偷多推一个未声明的字段，等于绕过类型契约私开接口。
 */
export function installPhaseLabel(p: PyProgress): string {
  switch (p.phase) {
    case 'download':
      return `下载 ${formatDownloadProgress(p.receivedBytes ?? 0, p.totalBytes ?? 0)}`;
    case 'verify':
      return '校验 · SHA-256';
    case 'extract':
      return `解包 · ${group(p.entries ?? 0)} 个文件 · ${String(Math.max(0, Math.round(p.percent)))}%`;
    case 'done':
      return '● 已就绪';
    case 'error':
      return p.message ?? '安装失败';
  }
}

/** 校验失败必须吓人 —— 因为它确实可能是中间人，而不是「网络抖了一下」。 */
export const VERIFY_FAILED_TEXT = '校验失败 · 文件可能被篡改或下载不完整';

export const RUNTIME_SOURCE_LABEL: Record<PyRuntime['source'], string> = {
  managed: 'Polaris 托管',
  system: '系统安装',
  manual: '手动指定',
};

/** `Python 3.13.14 · Polaris 托管` */
export function runtimeLabel(runtime: PyRuntime): string {
  return `Python ${runtime.version} · ${RUNTIME_SOURCE_LABEL[runtime.source]}`;
}

/** 状态栏那一段（空间有限，不带来源）。没有解释器是**一等状态**，不是空字符串。 */
export function runtimeShortLabel(runtime: PyRuntime | null): string {
  return runtime ? `Python ${runtime.version}` : '未装 Python';
}

/** 该平台在 catalog 里没有资产 —— 一等状态，如实说，并给出唯一的出路。 */
export const PLATFORM_UNAVAILABLE_TEXT = '此平台暂无可一键安装的运行时，请手动指定解释器。';

/** 探测不到系统 Python 也是一等状态 —— 绝不静默回落到「某个能跑的 python」。 */
export const NO_RUNTIME_TEXT = '未检测到 Python。';

/** 手动指定的授权模型，必须诚实地讲给用户听（他会问「为什么不让我填路径」）。 */
export const MANUAL_PICK_HINT =
  '出于安全考虑，只有你亲手在系统对话框里选中的解释器才会被允许运行。';

/** 卸载确认。释放的体积用的是**实测的目录占用**，不是 catalog 里的估算。 */
export function uninstallConfirmText(runtime: PyRuntime): string {
  const size = runtime.sizeBytes ? `将释放 ${formatBytes(runtime.sizeBytes)}。` : '';
  return `删除 Python ${runtime.version}？${size}正在用它运行的终端会话需要先关闭。`;
}
