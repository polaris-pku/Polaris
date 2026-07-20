/**
 * 设计守卫的常驻测试。
 *
 * `scripts/design-guard.mjs` 是 CI 里的一条命令；这个文件让同一套规则在 `pnpm test` 里也跑一遍。
 *
 * ── 为什么不把 16 条规则在这里重写一遍 ──
 * 那会造出第二份真值，而两份真值必然漂移 —— 这正是本次重设计在治的病（R1 唯一性）。
 * 所以这里**直接把那个脚本跑起来**，断言它退出码为 0；规则永远只有一份，就在脚本里。
 *
 * ── 另外补上脚本的三类盲区 ──
 * 1. 脚本只扫 `src/` 下的 `.ts` / `.tsx`。`src/index.css` / `tailwind.config.js` / `index.html`
 *    它一个都看不见 —— 而那条 Google Fonts 的 `@import`（规则 12 要杀的东西）恰恰就住在
 *    `index.css` 里，那些字号/圆角/阴影 token 也都定义在 `tailwind.config.js` 里。
 *    换句话说：**光靠脚本，任何人都能把 web font 和第 7 档字号原样加回来，16 条规则全绿。**
 * 2. 本次重设计的主要动作是**删除**。删掉的组件回潮是无声的，得有人钉着。
 * 3. `design-guard` 必须仍然挂在 `pnpm verify` 上，否则它可以被静默摘掉。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string) =>
  readFileSync(new URL(rel, new URL('../../', import.meta.url)), 'utf8');

const tailwindConfig = read('tailwind.config.js');
const indexCss = read('src/index.css');
const indexHtml = read('index.html');
const packageJson = read('package.json');

/** 剥注释 —— 注释里讨论被禁掉的东西是合法的（本文件上方就在讨论），代码里出现才不是。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

/**
 * 取出 `blockName: { … }` 这一层的直接键名。
 *
 * 用来对 `tailwind.config.js` 做「词表封闭」断言：R5 说的是「字号只有 5 档、圆角只有 3 档，
 * 超出即拒绝合并」—— 那就必须能机器判定「有没有第 7 档」，而不是只判定「有没有用 text-[18px]」。
 * 一个新加的具名 token（`fontSize: { huge: […] }` + `text-huge`）能穿过全部 16 条行规则。
 */
function directKeys(source: string, blockName: string): string[] {
  const open = new RegExp(`\\b${blockName}\\s*:\\s*\\{`).exec(source);
  if (!open) throw new Error(`tailwind.config.js 里找不到 ${blockName} 块`);

  let depth = 1;
  let top = '';
  for (let i = open.index + open[0].length; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) break;
      continue;
    }
    if (ch === ']') {
      depth -= 1;
      continue;
    }
    if (ch === '{' || ch === '[') {
      depth += 1;
      continue;
    }
    if (depth === 1) top += ch;
  }
  return [...top.matchAll(/(?:^|,)\s*['"]?([\w-]+)['"]?\s*:/g)].map((m) => m[1]);
}

describe('设计守卫（§6.3 的 16 条）', () => {
  it('scripts/design-guard.mjs 全绿', () => {
    // 规则的唯一真值源就是这个脚本 —— 这里只负责让它在 pnpm test 里也跑一次。
    // 用 process.execPath 而不是 'node'：不依赖 PATH 上有没有 node，也不受 nvm 影响。
    try {
      execFileSync(process.execPath, ['scripts/design-guard.mjs'], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (err) {
      const e = err as { stderr?: string; stdout?: string };
      throw new Error(`design-guard 有违规：\n${e.stderr ?? ''}${e.stdout ?? ''}`);
    }
  });
});

describe('脚本的盲区：css / tailwind 配置 / html', () => {
  it('运行期零网络请求：没有任何 web font（Google Fonts 的 @import 已删且不许回来）', () => {
    // 打包后是 file:// + 可能离线 —— 远程 @import 只会静默失败。这条规则住在 index.css 里，
    // 而 design-guard 只扫 .ts/.tsx，它永远看不见这里。
    for (const [name, source] of [
      ['src/index.css', indexCss],
      ['tailwind.config.js', tailwindConfig],
      ['index.html', indexHtml],
    ] as const) {
      const code = stripComments(source);
      expect(code, `${name} 不许出现 Google Fonts`).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
      expect(code, `${name} 不许出现 Space Grotesk`).not.toMatch(/Space Grotesk/);
      expect(code, `${name} 不许有远程 @import`).not.toMatch(/@import\s+url\(\s*['"]?https?:/);
    }
  });

  it('字体栈只有 --font-ui 与 --font-mono（display 档已彻底删除）', () => {
    const code = stripComments(tailwindConfig);
    expect(directKeys(code, 'fontFamily').sort()).toEqual(['mono', 'sans']);
    expect(stripComments(indexCss)).not.toMatch(/--font-display|--font-sans\b/);
  });

  it('字阶只有 6 档：5 档文本 + 1 档等宽（R5 —— 超出即拒绝合并）', () => {
    expect(directKeys(stripComments(tailwindConfig), 'fontSize').sort()).toEqual([
      'body',
      'code',
      'headline',
      'meta',
      'micro',
      'title',
    ]);
  });

  it('圆角只有 3 档（rounded-full 是 Tailwind 内建的，不在 extend 里）', () => {
    expect(directKeys(stripComments(tailwindConfig), 'borderRadius').sort()).toEqual([
      'chip',
      'modal',
      'panel',
    ]);
  });

  it('元素级阴影全灭：boxShadow 只剩 modal 一个', () => {
    expect(directKeys(stripComments(tailwindConfig), 'boxShadow')).toEqual(['modal']);
  });

  it('ink / line 迁移垫片已删除（迁移已完成，留着只会让漏改的类名继续显示）', () => {
    const colors = directKeys(stripComments(tailwindConfig), 'colors');
    expect(colors).not.toContain('ink');
    expect(colors).not.toContain('line');
    // 品牌组 brand + 四个强调色 + 三个表面 / 边框 / 文本组。
    expect(colors.sort()).toEqual([
      'brand',
      'command',
      'danger',
      'edge',
      'fg',
      'human',
      'ok',
      'surface',
    ]);
  });
});

describe('删掉的东西必须留在坟里', () => {
  // 本次重设计的主要动作是删除；删除的回潮是无声的（没人会 review 一个「又出现了」的文件）。
  const buried = [
    // R2 / R4：渲染后端没给的字段就是在撒谎；送不到后端的按钮不该存在。
    'src/components/LiveRunPanel.tsx',
    'src/components/NodeInspector.tsx',
    'src/components/NodeExecutionLog.tsx',
    'src/components/FileOpsPanel.tsx',
    'src/components/DeliveryReport.tsx',
    'src/components/ExecutionTimeline.tsx',
    'src/components/InterveneDialog.tsx',
    // 双语工厂：gloss prop 的宿主。
    'src/components/ui/Card.tsx',
    'src/components/ui/Collapsible.tsx',
    // 已无人 import 的死数据模块。
    'src/data/nodeExecutionLogs.ts',
    // 被本次重设计**顺带**杀死的模块：删掉最后一个消费者后，它们就成了无人 import 的孤儿。
    //   api/config.ts        唯一消费者是 AppShell 那条 LOCAL/LIVE/OFFLINE 遥测徽章（已随底部遥测条删除）；
    //                        真正的 mock 选路在 api/transport.ts 里自己判 VITE_USE_MOCK，从不 import 它。
    //   data/deliveryReport.ts 唯一消费者是 InterveneDialog（按 R4 删除）。
    'src/api/config.ts',
    'src/data/deliveryReport.ts',
    // mock 推进引擎的残骸：`介入` / `Next Step` / `Auto Run` 三个按钮在信息架构重排时就删了，
    // 这些模块从那以后一直是无调用者的死代码（真实 run 由后端事件驱动 taskSlice.applyLiveProgress）。
    //   slices/councilSlice.ts  goToCouncil / confirmCouncilOption —— 裁决由后端自主完成，没有回写通道；
    //   data/councilOptions.ts  verdictDefs —— 旧 CouncilBoard「你的裁决」面板的词表；
    //   lib/runReplay.ts        buildRunReplay —— 启动页「样例 · Run 回放」入口已在 daaa45d 删除。
    'src/store/slices/councilSlice.ts',
    'src/data/councilOptions.ts',
    'src/lib/runReplay.ts',
    //   data/scenario.ts  按关键词编造整套演示场景（议会议程 / 交付报告 / 需求分析）。
    //                     消费方全删干净后只剩 recommendAgents 一个函数，已搬去
    //                     data/agentRecommendation.ts —— 别再让「场景推导」回来。
    'src/data/scenario.ts',
  ];

  it.each(buried)('%s 已删除', (rel) => {
    expect(existsSync(new URL(rel, new URL('../../', import.meta.url)))).toBe(false);
  });
});

describe('守卫本身不许被摘掉', () => {
  it('design-guard 仍挂在 pnpm verify 上', () => {
    const pkg = JSON.parse(packageJson) as { scripts: Record<string, string> };
    expect(pkg.scripts.verify).toContain('design-guard');
  });
});
