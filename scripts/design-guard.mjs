#!/usr/bin/env node
/**
 * 设计守卫 —— 把设计规格里可 grep 的部分变成一个会失败的命令。
 *
 *   node scripts/design-guard.mjs                 # 扫全 src
 *   node scripts/design-guard.mjs src/components/ui src/lib/runState.ts
 *
 * 为什么需要它：R5 的那句「超出即拒绝合并」，靠自律是守不住的 —— 一年里 355 处裸 slate、
 * 145 处圆角、8 套色板就是这么长出来的。规则一旦能被机器判，它就不再是品味问题。
 *
 * 只扫 .ts / .tsx，且**先剥掉注释**（注释里可以自由讨论被禁掉的东西，比如本文件上方那些名字）。
 * 跳过测试文件：它们不渲染，断言里出现类名是正常的。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** 汉字（CJK 统一表意文字基本区）—— C2 / C3 两条规则要靠它判「这一行有没有中文」。 */
const CJK = /[一-鿿]/;

/** 主句全屏唯一的宿主。 */
const MISSION_LINE = 'src/components/run/MissionLine.tsx';
/** 那一行 `原始事件 · {n} 条 ↗` 的唯一宿主（F3 的物理保证）。 */
const FOLD = 'src/components/ui/Fold.tsx';
/** L3 是唯一允许出现协议词的 UI 区域（F2）。 */
const EVENT_STREAM = 'src/components/dock/EventStreamChannel.tsx';

/**
 * 【R3 / I5】`term:start` 只能由用户手势触发。
 * 允许出现 `startTerminalRun` / `term:start` 的文件 = 定义处 + 五个用户手势入口。
 * 任何别的文件出现它 —— 尤其是 backend:event 的 handler 链路上 —— 都是一条 agent → 宿主的 RCE 通道。
 */
const TERMINAL_START_ALLOWLIST = new Set([
  'src/store/types.ts',
  'src/store/slices/terminalSlice.ts',
  'src/lib/pythonTerminal.ts',
  'src/api/terminal.ts',
  'src/components/ProjectTree.tsx',
  'src/pages/FileViewer.tsx',
  'src/components/StatusBar.tsx',
  'src/components/dock/TerminalChannel.tsx',
  'src/components/dock/RuntimeChannel.tsx',
]);

const inUi = (p) => p.startsWith('src/pages/') || p.startsWith('src/components/');

/** 逐行规则。`only` 为真时表示「除了 exempt 里的文件，谁都不许有」。 */
const RULES = [
  {
    id: 1,
    re: /text-\[\d+px\]/,
    msg: '禁任意字号：字阶只有 micro / meta / body / title / headline / code',
  },
  { id: 2, re: /\bleading-[\w[]/, msg: '禁裸行高：行高已焊进 fontSize 元组' },
  {
    id: 3,
    re: /\bfont-(thin|extralight|light|medium|semibold|extrabold|black)\b/,
    msg: '字重全应用只有 400 / 700：雅黑没有真 500/600，声明它们会被 GDI 合成加粗涂糊',
  },
  {
    id: 4,
    re: /\b(text|bg|border|ring|from|to|via|divide|outline|decoration|shadow)-slate-\d+/,
    msg: '禁 slate 色阶：文本走 fg-*，表面走 surface-*，边框走 edge-*',
  },
  {
    id: 5,
    re: /\b(emerald|rose|violet|indigo|amber|cyan|teal|sky|blue|purple|fuchsia|lime|green|red|orange|yellow)-\d{2,3}\b/,
    msg: '禁原始色板：强调色只有 command / human / ok / danger 四个，且只编码状态',
  },
  {
    id: 6,
    re: /\bshadow-(glow|glow-human|panel|lg|md|sm|xl|2xl|inner|black)/,
    msg: '元素级阴影全灭：纵深只由 surface 色阶 + edge 表达。只留 shadow-modal',
  },
  {
    id: 7,
    re: /\brounded-(sm|md|lg|xl|2xl|3xl|r|l|t|b|tl|tr|bl|br)\b|\brounded(?![-\w])/,
    msg: '圆角只有 3 档：rounded-chip(4) / rounded-panel(8) / rounded-modal(12)，加上 rounded-full',
  },
  { id: 8, re: /-2\.5\b/, msg: '间距走 4pt 网格：10px（*-2.5）是唯一需要清掉的中间态' },
  {
    id: 9,
    re: /callsign/,
    extra: (line) => CJK.test(line),
    msg: 'C2：.callsign 的内容必须是纯 ASCII —— uppercase 对汉字是 no-op，tracking 却把「执行中」拉成「执 行 中」',
  },
  {
    id: 10,
    re: /\buppercase\b|\btracking-\w/,
    extra: (line) => CJK.test(line),
    msg: 'C3：中文永不 uppercase、永不 tracking > 0',
  },
  {
    id: 11,
    re: /text-headline/,
    only: (p) => p !== MISSION_LINE,
    msg: `主句是全屏唯一的 24px —— text-headline 只允许出现在 ${MISSION_LINE}`,
  },
  {
    id: 12,
    re: /font-display|Space Grotesk|fonts\.googleapis/,
    msg: 'Space Grotesk 已死：它没有任何中文字形，且它的 CDN @import 在打包版里从来没生效过',
  },
  {
    id: 13,
    re: /原始事件 ·/,
    only: (p) => p !== FOLD,
    msg: `F3：那一行 L3 入口由 Fold 的 evidence prop 自动渲染 —— 措辞/形状/位置只允许定义在 ${FOLD}`,
  },
  {
    id: 14,
    re: /\bgloss\b|ui\/Card|ui\/Collapsible/,
    msg: '双语工厂已死：gloss prop / ui/Card / ui/Collapsible 都已删除（用 Panel / Fold）',
  },
  {
    id: 15,
    re: /mailbox\.|\bN0\b|\bN7\b|\bN13\b|\bN18\b|pending_gate|RAW_SPEC_TEXT|SYSTEM NOMINAL|COORD ·|SINGLE_AGENT/,
    only: (p) => inUi(p) && p !== EVENT_STREAM,
    msg: `F2：协议词只允许活在 L3（${EVENT_STREAM}）与 D2 的灰色注解里`,
  },
  {
    id: 16,
    re: /startTerminalRun|term:start/,
    only: (p) => !TERMINAL_START_ALLOWLIST.has(p),
    msg: 'R3/I5 硬红线：term:start 只能由用户手势触发，永远不能被 backend:event 的 handler 直接或间接调用',
  },
];

/** 剥注释：注释里讨论被禁掉的东西是合法的，代码里出现才不是。（`://` 不当行注释处理。） */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

function collect(target, out) {
  const st = statSync(target, { throwIfNoEntry: false });
  if (!st) return;
  if (st.isDirectory()) {
    for (const entry of readdirSync(target)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      collect(join(target, entry), out);
    }
    return;
  }
  if (!/\.tsx?$/.test(target)) return;
  if (/\.(test|spec)\.tsx?$/.test(target)) return;
  if (target.endsWith('.d.ts')) return;
  out.push(target);
}

function checkFile(file) {
  const path = relative(process.cwd(), file).split('\\').join('/');
  const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
  const hits = [];
  let headlineCount = 0;

  lines.forEach((line, i) => {
    if (path === MISSION_LINE && /text-headline/.test(line)) headlineCount += 1;
    for (const rule of RULES) {
      if (rule.only && !rule.only(path)) continue;
      if (!rule.re.test(line)) continue;
      if (rule.extra && !rule.extra(line)) continue;
      hits.push({ line: i + 1, id: rule.id, msg: rule.msg, text: line.trim() });
    }
  });

  if (path === MISSION_LINE && headlineCount > 1) {
    hits.push({
      line: 0,
      id: 11,
      msg: `主句是全屏唯一的 24px —— MissionLine 里 text-headline 出现了 ${String(headlineCount)} 次`,
      text: '',
    });
  }
  return { path, hits };
}

const targets = process.argv.slice(2);
const files = [];
for (const t of targets.length > 0 ? targets : ['src']) collect(t, files);

let total = 0;
for (const file of files.sort()) {
  const { path, hits } = checkFile(file);
  if (hits.length === 0) continue;
  total += hits.length;
  console.error(`\n${path}`);
  for (const h of hits.sort((a, b) => a.line - b.line)) {
    const where = h.line > 0 ? `${String(h.line)}:` : '';
    console.error(`  ${where.padEnd(5)} [规则 ${String(h.id)}] ${h.msg}`);
    if (h.text) console.error(`        ${h.text.slice(0, 110)}`);
  }
}

if (total > 0) {
  console.error(
    `\n设计守卫：${String(total)} 处违规（扫描 ${String(files.length)} 个文件）。规则见 FINAL-SPEC §4 与 IMPL-PLAN §6.3。`,
  );
  process.exit(1);
}
console.log(`设计守卫通过（扫描 ${String(files.length)} 个文件）。`);
