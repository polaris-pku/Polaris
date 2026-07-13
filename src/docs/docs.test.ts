/**
 * 文档漂移 = 一个失败的测试。
 *
 * 「写一份文档」是一次性动作，「维护一份文档」不是 —— 靠自律维护的文档半年后就是谎言。
 * 所以文档里那些**同时也存在于代码里**的事实（语义步骤名、Python 版本号、校验和），
 * 全部在这里被钉死：改了代码没改文档 → 红。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COLLAPSED_SECTIONS, DEFAULT_HELP_TOPIC, DOCS, HELP_ANCHORS, parseHelpTopic } from '@/docs';
import { STEPS } from '@/lib/eventGraph';
import { HELP_TOPICS } from '@/lib/glossary';
import { parseDoc, slugify } from '@/lib/markdownLite';

const read = (p: string) => readFileSync(p, 'utf8');

const overviewDoc = read('src/docs/overview.md');
const pyDoc = read('src/docs/python-terminal.md');
const protoDoc = read('src/docs/protocol.md');

/** catalog 由 W2-5 生成并随代码提交。读不到它本身就是一个必须变红的事实。 */
type Catalog = {
  tag: string;
  recommended: string;
  items: {
    catalogId: string;
    version: string;
    assets: Record<string, { sha256: string; downloadBytes: number; installedBytes: number }>;
  }[];
};
const loadCatalog = (): Catalog => JSON.parse(read('electron/python-catalog.json')) as Catalog;

describe('文档不许漂移', () => {
  it('协议参考列出了 eventGraph 的每一个语义步骤', () => {
    for (const step of Object.values(STEPS)) {
      expect(protoDoc).toContain(step.labelCn);
    }
  });

  it('帮助文档里的 Python 版本号与主进程的 catalog 一致', () => {
    const catalog = loadCatalog();
    expect(catalog.items.length).toBeGreaterThan(0);
    for (const item of catalog.items) {
      expect(pyDoc).toContain(item.version);
    }
  });

  it('catalog 的每个条目都有真实的校验和（不是一串 0）', () => {
    const catalog = loadCatalog();
    for (const item of catalog.items) {
      const assets = Object.values(item.assets);
      expect(assets.length).toBeGreaterThan(0);
      for (const asset of assets) {
        expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(asset.sha256).not.toMatch(/^0+$/);
      }
    }
  });
});

describe('帮助目录与文档一一对应', () => {
  it('HELP_TOPICS 的每个 id 都有一篇文档', () => {
    for (const topic of HELP_TOPICS) {
      expect(DOCS[topic.id]).toBeTruthy();
    }
    expect(Object.keys(DOCS).sort()).toEqual(HELP_TOPICS.map((t) => t.id).sort());
  });

  it('每个上下文锚点都真的落在某一节上 —— 从出错的地方长出来的文档不许跳空', () => {
    for (const [key, value] of Object.entries(HELP_ANCHORS)) {
      const { topicId, anchor } = parseHelpTopic(value);
      const doc = DOCS[topicId];
      expect(doc, `${key} 指向了不存在的文档`).toBeTruthy();
      expect(anchor, `${key} 没带锚点`).toBeTruthy();

      const page = parseDoc(doc);
      const ids = [
        ...page.sections.map((s) => s.id),
        ...page.sections.flatMap((s) =>
          s.blocks.filter((b) => b.kind === 'h3').map((b) => (b.kind === 'h3' ? b.id : '')),
        ),
      ];
      expect(ids, `${key} 的锚点 ${String(anchor)} 在 ${topicId} 里不存在`).toContain(anchor);
    }
  });

  it('主题串解析：裸 id / 带锚点 / 原生菜单的路由 / 空值', () => {
    expect(parseHelpTopic(null)).toEqual({ topicId: DEFAULT_HELP_TOPIC, anchor: null });
    expect(parseHelpTopic('protocol')).toEqual({ topicId: 'protocol', anchor: null });
    expect(parseHelpTopic('help/protocol')).toEqual({ topicId: 'protocol', anchor: null });
    expect(parseHelpTopic('python-terminal#已知限制')).toEqual({
      topicId: 'python-terminal',
      anchor: '已知限制',
    });
    // 不认识的主题不抛异常，回落到主文档：帮助打不开比帮助不完整更坏
    expect(parseHelpTopic('nope#x').topicId).toBe(DEFAULT_HELP_TOPIC);
  });
});

describe('Python 终端文档说清了那几件用户一定会怀疑的事', () => {
  const page = parseDoc(pyDoc);
  const titles = page.sections.map((s) => s.title);

  it('目录结构完整', () => {
    expect(titles).toEqual([
      '它是什么',
      '快速开始',
      '选择解释器',
      '安装一个 Python',
      '运行一个文件',
      '交互式 Python（REPL）',
      '装第三方包',
      '已知限制',
      '常见问题',
    ]);
  });

  it.each([
    ['input() 能用', 'input()'],
    ['REPL 走 python -i -u', 'python -i -u'],
    ['Windows 上没有真正的中断信号', '没有真正的中断信号'],
    ['输出超 2000 行会截断', '2000 行'],
    ['只能运行项目目录内的文件', '只能运行项目目录内的文件'],
    ['中文列对齐不做保证', 'Sarasa Mono SC'],
    ['永不自动执行', '没有自动重跑'],
  ])('%s', (_name, needle) => {
    expect(pyDoc).toContain(needle);
  });

  it('已知限制与常见问题是默认收起的那两节（放在最后）', () => {
    expect(titles.slice(-2)).toEqual(['已知限制', '常见问题']);
  });
});

/**
 * 总览是**交给真实用户**的那一篇，而它最重要的内容不是「能干什么」，是「干不了什么」。
 *
 * 所以这一节的断言是**反向**的：它守的不是「文档写全了」，是「没人把限制偷偷删掉」。
 * 每一条都在代码里有出处（注释里标了）。删限制 = 红。
 */
describe('总览如实写出了每一条能力边界', () => {
  const page = parseDoc(overviewDoc);
  const titles = page.sections.map((s) => s.title);

  it('目录结构完整', () => {
    expect(titles).toEqual([
      '它是什么',
      '动手之前',
      '快速开始',
      '一次需求会经历什么',
      '文件去了哪',
      'Python 终端',
      '观测：你能看到什么',
      '已知限制',
      '常见问题',
    ]);
  });

  it('已知限制与常见问题是默认收起的那两节（放在最后）', () => {
    expect(titles.slice(-2)).toEqual(['已知限制', '常见问题']);
    // 收起哪两节是 index.ts 说了算的 —— 标题对不上就等于「收了个寂寞」
    expect(titles.slice(-2)).toEqual([...COLLAPSED_SECTIONS]);
  });

  it('「一次需求会经历什么」逐字沿用 eventGraph 的语义步骤名', () => {
    const h3 = page.sections
      .find((s) => s.title === '一次需求会经历什么')!
      .blocks.filter((b) => b.kind === 'h3')
      .map((b) => (b.kind === 'h3' ? b.text : ''));
    // 「议会」不单列小节（真实运行不触发），但必须在正文里交代 —— 其余六步逐字对上
    expect(h3).toEqual(['需求受理', '分派与上下文', 'Agent 执行', '产出', '审查', '交付']);
    expect(overviewDoc).toContain(STEPS.council.labelCn);
  });

  it.each([
    // 1. 人挡不住 agent：can_create_merge_authorization 恒 false；前端裁决按钮不回写后端
    ['人挡不住 agent', '人挡不住 agent'],
    ['没有写入前确认 / 同意拒绝按钮', '同意 / 拒绝按钮'],
    // 1b. AUTO_APPROVE=1（electron/backend-host.ts:79）→ permission-handler 直接选 options[0]
    ['agent 的权限请求被自动放行', '自动放行'],
    // 1c. terminal-handler.ts 的 spawn 没有任何路径校验，且继承全量 process.env
    ['Polaris 不是沙箱', 'Polaris 不是沙箱'],
    ['命令执行通道不受目录限制', '不受限制的命令执行通道'],
    // 2. driver-runtime-agent-execution-facade.ts 的 enqueue 是严格 FIFO，role_id 硬编码
    ['并发是排队', '多个需求不会并行，是排队'],
    ['排队是 FIFO 且后端不发排队事件', 'FIFO'],
    // 3. ACP_WORKSPACE 是 BCD 的进程级全局状态（liveRuns.canBindWorkspace）
    ['不能跨项目并行', '不能跨项目并行'],
    // 4. CommandDriverTransport 没实现 interrupt；cancelRun 零调用
    ['没有取消按钮', '没有取消按钮'],
    // 5. contract-runner 把 agent 消息正文降维成字符数丢掉
    ['看不到 agent 的文字回复正文', '看不到 agent 的文字回复正文'],
    // 6. 打包版只随包分发 claude
    ['只有 Claude Code 一个 agent', '只有 Claude Code 一个 agent'],
    // 7. 管道式终端，不是真 PTY
    ['Python 终端不是真正的 TTY', 'Python 终端不是真正的 TTY'],
    // 产物只来自 tool_call_update 里 type==='diff' 的块 —— 命令写的盘一个都不登记
    ['产出卡只认写文件工具', '产出卡只认写文件工具'],
    // artifact-finalizer + integration-v0-flow:780：选中 0 个产物 → run 判失败
    ['没有产物会把 run 判成失败', '没有可选产物'],
    // 交付报告数的是工作树里的一条元数据记录
    ['已交付 N 个文件恒为 1', '恒为 1'],
    ['文件树只补挂一个文件', '文件树只补挂一个文件'],
    // Gate 出厂只挂一条空检查
    ['Gate 放行一切', '放行一切'],
    // eventGraph.statusOf 靠 .failed 后缀判断，后端发的是 agent.execution_completed + failed
    ['执行失败时步骤卡仍显示完成', '仍然显示成完成'],
    ['ContextPack 是占位', 'ContextPack 是占位'],
    ['团队页是演示数据', '「团队」页是演示数据'],
    ['验收标准不会发给 agent', '「验收标准」不会发给 agent'],
    ['Checkpoint 不能回滚', 'Checkpoint 不能回滚'],
    ['议会不触发', '不会触发'],
    // backendBridge 的 PROVIDERS：需求正文与文件内容要发给模型服务商
    ['代码会出网', '你的代码会发给模型服务商'],
    // 全仓没有任何 usage/cost 上报
    ['花费不可见', '花费不可见'],
  ])('%s', (_name, needle) => {
    expect(overviewDoc).toContain(needle);
  });

  /**
   * 这三句是初稿里**真的写过**的假保证，被核查逐条在代码里证伪。
   * 钉在这里，防的是「顺手改文案时又把它写回来」。
   */
  it.each([
    ['目录级边界并不存在（terminal 通道没有任何路径校验）', '唯一守得住的边界'],
    ['不是「没有云端」：需求正文与文件内容要发给模型服务商', '没有云端'],
    [
      '「Polaris 永远不会自动运行任何脚本」只对 Python 终端成立，对 agent 不成立',
      'Polaris 永远不会自动运行任何脚本',
    ],
  ])('不许写回来：%s', (_name, banned) => {
    expect(overviewDoc).not.toContain(banned);
  });
});

describe('帮助抽屉的默认入口是总览', () => {
  it('总览排在目录第一位，且是无参 openHelp() 的落点', () => {
    expect(HELP_TOPICS[0].id).toBe('overview');
    expect(DEFAULT_HELP_TOPIC).toBe('overview');
    expect(parseHelpTopic(null).topicId).toBe('overview');
  });
});

describe('文档只用 markdownLite 认得的语法', () => {
  // 解析器只有 7 种块、行内只认反引号：粗体 / 表格 / 链接 / HTML 会**原样漏成字面量**给用户看
  it.each(Object.keys(DOCS))('%s 没有用到解析器不认的语法', (id) => {
    const doc = DOCS[id];
    expect(doc, '出现了粗体（会漏成字面的星号）').not.toMatch(/\*\*/);
    expect(doc, '出现了 markdown 链接（会漏成字面的方括号）').not.toMatch(/\[[^\]]*\]\([^)]*\)/);
    expect(doc, '出现了表格（解析器没有表格）').not.toMatch(/^\s*\|/m);
    expect(doc, '出现了 HTML 标签').not.toMatch(/<[a-zA-Z/][^>]*>/);
    // 范围刻意避开 U+25xx：▶ ■ ● ◈ 是文档里指代按钮的几何字形，不是 emoji
    expect(doc, '出现了 emoji').not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    expect(doc, '出现了 emoji 变体选择符').not.toMatch(/\uFE0F/);
  });
});

describe('Python 体积是分平台的 —— 不许再出现那个错误的单一数字', () => {
  /** `pythonFormat.formatBytes` 是 1024 进制；文档给的是取整到 MB 的约数。 */
  const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);

  it('两篇文档里的体积都与 catalog 对得上（catalog 变了 → 文档必须跟着变）', () => {
    const catalog = loadCatalog();
    const rec = catalog.items.find((i) => i.catalogId === catalog.recommended);
    expect(rec, 'catalog 里找不到 recommended 那一项').toBeTruthy();
    const a = rec!.assets;

    const win = a['x86_64-pc-windows-msvc'];
    const mac = a['aarch64-apple-darwin'];
    const linux = a['x86_64-unknown-linux-gnu'];

    const sizes =
      `Windows x64 约下载 ${String(mb(win.downloadBytes))} MB、安装后 ${String(mb(win.installedBytes))} MB；` +
      `macOS（Apple Silicon）约 ${String(mb(mac.downloadBytes))} MB / ${String(mb(mac.installedBytes))} MB；` +
      `Linux x64 约 ${String(mb(linux.downloadBytes))} MB / ${String(mb(linux.installedBytes))} MB`;

    expect(pyDoc).toContain(sizes);
    expect(overviewDoc).toContain(sizes);
  });

  it('那个错的「28 MB / 250 MB」不许再出现在任何一篇里', () => {
    // 前置的 (?<!\d) 是必须的：否则将来 catalog 涨到 128 MB，这条会被自己的子串咬红
    for (const [id, doc] of Object.entries(DOCS)) {
      expect(doc, `${id} 又写回了 28 MB`).not.toMatch(/(?<!\d)28(\.0)?\s*MB/);
      expect(doc, `${id} 又写回了 250 MB`).not.toMatch(/(?<!\d)250\s*MB/);
    }
  });
});

describe('锚点 slug 与标题同源', () => {
  it('slugify 保留中文、把空格压成连字符', () => {
    expect(slugify('安装一个 Python')).toBe('安装一个-python');
    expect(slugify('Gate 与合议')).toBe('gate-与合议');
    expect(slugify('为什么不能运行项目外的文件？')).toBe('为什么不能运行项目外的文件');
  });
});
