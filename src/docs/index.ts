/**
 * 帮助文档的入口。
 *
 * 文档是 `src/docs/*.md`，用 Vite 的 `?raw` 内联进 bundle —— **零 IPC、零 extraResources**。
 * 打包时它们就是 JS 字符串常量，`file://` 下也一定读得到（外部请求在离线的桌面应用里是死路：
 * `src/index.css` 那条 Google Fonts 的 `@import` 已经证明过一次）。
 *
 * 文档漂移由 `src/docs/docs.test.ts` 守住：改了 `eventGraph.STEPS` 或 Python catalog
 * 却没改文档 —— 测试红。
 */
import overview from './overview.md?raw';
import pythonTerminal from './python-terminal.md?raw';
import protocol from './protocol.md?raw';

/** topicId → markdown 原文。id 与 `glossary.HELP_TOPICS` 的 id 一一对应。 */
export const DOCS: Record<string, string> = {
  overview,
  'python-terminal': pythonTerminal,
  protocol,
};

/**
 * 抽屉在没指定主题时打开哪一篇。
 *
 * 是「总览」而不是「Python 终端」：侧栏页脚 / 状态栏 / 启动页的「帮助」都是无参调用，
 * 点它的人问的是「这东西能干什么」，不是「怎么跑 .py」。Python 终端只是其中一节。
 */
export const DEFAULT_HELP_TOPIC = 'overview';

/**
 * 上下文入口用的锚点常量 —— **从出错的地方长出来的文档才会被读**。
 * 值的形状是 `<topicId>#<锚点>`，可以直接喂给 `openHelp()`。
 */
export const HELP_ANCHORS: Record<string, string> = {
  /** 提需求前 / 设置页：它要联网、要花钱、不是沙箱 */
  beforeYouStart: 'overview#动手之前',
  /** 第二个 run 迟迟不动时：并发是排队，而后端不发排队事件 */
  queued: 'overview#已知限制',
  /** 跨项目提交被拒时：工作区是后端的全局状态 */
  workspaceBlocked: 'overview#已知限制',
  /** 「产出」卡为空 / 找不到 agent 写的文件时：以磁盘为准 */
  missingFiles: 'overview#文件去了哪',
  /** 终端页脚「已终止」旁：为什么 Windows 上不能 Ctrl+C */
  terminalInterrupt: 'python-terminal#已知限制',
  /** 运行时管理器顶部：这些运行时从哪来 */
  runtimeSource: 'python-terminal#安装一个-python',
  /** 安装校验失败旁：这是什么意思 */
  checksumFailed: 'python-terminal#安装一个-python',
  /** 手动指定解释器旁：为什么只能走系统对话框 */
  interpreter: 'python-terminal#选择解释器',
  /** 输出被截断时：为什么会截断 */
  outputTruncated: 'python-terminal#已知限制',
  /** Gate 拦住 run 时，主句旁：这是什么 */
  gate: 'protocol#gate-与合议',
  /** 事件流频道顶部：这些事件是什么 */
  events: 'protocol#事件与阶段',
};

/**
 * 这两节默认收起 —— 它们是「出问题时才需要」的内容，不该在第一屏挡住「怎么用」。
 * （文档里的 `##` 本身就是一个 Fold：连文档都用界面的折叠语法。）
 */
export const COLLAPSED_SECTIONS: readonly string[] = ['已知限制', '常见问题'];

/** 把 `openHelp()` 收到的主题串（`'protocol'` / `'python-terminal#已知限制'`）拆成 id + 锚点。 */
export function parseHelpTopic(topic: string | null): { topicId: string; anchor: string | null } {
  // 原生菜单推来的是路由串（`help/python-terminal`）—— 在这里剥掉前缀，别让调用方各剥一次。
  const raw = (topic ?? DEFAULT_HELP_TOPIC).replace(/^help\//, '');
  const [id, anchor] = raw.split('#');
  const topicId = id in DOCS ? id : DEFAULT_HELP_TOPIC;
  return { topicId, anchor: anchor ? anchor : null };
}
