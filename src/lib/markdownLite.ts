/**
 * 帮助文档的 markdown 子集解析器 —— **不引入任何 markdown 库**。
 *
 * 为什么自己写：一个通用 markdown 渲染器会立刻把 12 个字号、6 档字重和一整套自己的
 * 排版规则带回界面里（h1…h6 + em + strong + table + hr…），而字阶只有 5 档是这次重设计
 * 唯一真正守得住的东西。文档是我们自己写的，语法子集是可控的 —— 那就把子集写死。
 *
 * **只有 7 种块，没有第 8 种**（`BLOCK_KINDS` 是它的机器判据，`markdownLite.test.ts` 守住）：
 *   h2 / h3 / p / ul / ol / pre / quote
 * 行内只有一种标记：反引号包起来的 `code`。**没有粗体、没有斜体、没有链接语法** ——
 * 粗体会立刻要求第三档字重（雅黑没有真 500/600），链接在一个离线桌面应用里没有落点。
 */

/** 行内片段。`code` 为真 = 反引号包起来的等宽片段。 */
export type DocSpan = { text: string; code: boolean };

/** 文档块。**7 种，且只有 7 种。** */
export type DocBlock =
  | { kind: 'h2'; id: string; text: string }
  | { kind: 'h3'; id: string; text: string }
  | { kind: 'p'; spans: DocSpan[] }
  | { kind: 'ul'; items: DocSpan[][] }
  | { kind: 'ol'; items: DocSpan[][] }
  | { kind: 'pre'; text: string }
  | { kind: 'quote'; spans: DocSpan[] };

/** 允许的块类型全集。多一种都要先改这一行 —— 于是它会在 code review 里被看见。 */
export const BLOCK_KINDS = ['h2', 'h3', 'p', 'ul', 'ol', 'pre', 'quote'] as const;

export type BlockKind = (typeof BLOCK_KINDS)[number];

/** 一个 `##` 节。**文档里的 `##` 本身就是一个 Fold** —— 连文档都用界面的折叠语法。 */
export type DocSection = { id: string; title: string; blocks: DocBlock[] };

export type DocPage = {
  /** `#` 标题 */
  title: string;
  /** 第一个 `##` 之前的块（正常情况下为空，但不丢内容） */
  intro: DocBlock[];
  sections: DocSection[];
};

/**
 * 锚点 id：直接保留中文（DOM id 允许非 ASCII，`getElementById` 也认）。
 * 空白 → `-`，去掉会在 CSS 选择器里咬人的字符。
 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w一-鿿-]/g, '');
}

/** 行内解析：只认反引号。奇数段是普通文本，偶数段是 code。 */
function spansOf(line: string): DocSpan[] {
  const parts = line.split('`');
  const spans: DocSpan[] = [];
  parts.forEach((text, index) => {
    if (text === '') return;
    spans.push({ text, code: index % 2 === 1 });
  });
  return spans;
}

/**
 * 把 markdown 源码解析成块序列。无法识别的行一律降级成段落文本 ——
 * **不丢内容、不抛异常**：文档解析失败在用户那里的表现应该是「排版朴素」，不是「帮助打不开」。
 */
export function parseBlocks(source: string): DocBlock[] {
  const lines = source.split('\n');
  const blocks: DocBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'p', spans: spansOf(paragraph.join(' ')) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    // 围栏代码块：原样保留（含缩进），直到闭合围栏或文件结束
    if (trimmed.startsWith('```')) {
      flushParagraph();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        body.push(lines[i]);
        i += 1;
      }
      blocks.push({ kind: 'pre', text: body.join('\n') });
      continue;
    }

    if (trimmed === '') {
      flushParagraph();
      continue;
    }

    // `#` 是文档标题，由 parseDoc 处理；在块序列里它不占位
    if (/^#\s+/.test(trimmed)) {
      flushParagraph();
      continue;
    }

    if (/^###\s+/.test(trimmed)) {
      flushParagraph();
      const text = trimmed.replace(/^###\s+/, '');
      blocks.push({ kind: 'h3', id: slugify(text), text });
      continue;
    }

    if (/^##\s+/.test(trimmed)) {
      flushParagraph();
      const text = trimmed.replace(/^##\s+/, '');
      blocks.push({ kind: 'h2', id: slugify(text), text });
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      flushParagraph();
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        body.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      i -= 1;
      blocks.push({ kind: 'quote', spans: spansOf(body.join(' ')) });
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      flushParagraph();
      const items: DocSpan[][] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(spansOf(lines[i].trim().replace(/^[-*]\s+/, '')));
        i += 1;
      }
      i -= 1;
      blocks.push({ kind: 'ul', items });
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      flushParagraph();
      const items: DocSpan[][] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(spansOf(lines[i].trim().replace(/^\d+\.\s+/, '')));
        i += 1;
      }
      i -= 1;
      blocks.push({ kind: 'ol', items });
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  return blocks;
}

/** 解析成「标题 + 一列 `##` 节」——`##` 节就是抽屉里的 Fold。 */
export function parseDoc(source: string): DocPage {
  const titleLine = source.split('\n').find((l) => /^#\s+/.test(l.trim()));
  const title = titleLine ? titleLine.trim().replace(/^#\s+/, '') : '';

  const blocks = parseBlocks(source);
  const intro: DocBlock[] = [];
  const sections: DocSection[] = [];

  for (const block of blocks) {
    if (block.kind === 'h2') {
      sections.push({ id: block.id, title: block.text, blocks: [] });
      continue;
    }
    if (sections.length === 0) {
      intro.push(block);
      continue;
    }
    sections[sections.length - 1].blocks.push(block);
  }

  return { title, intro, sections };
}
