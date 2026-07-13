/**
 * markdownLite 的契约测试：**七种块，且只有七种。**
 *
 * 最后那条（`只有七种`）才是这个文件存在的理由 —— 它守的不是解析器，是字阶：
 * 每多支持一种块（表格、h4、粗体、图片），界面上就多一个字号或多一档字重，
 * 而「一屏最多 4 档字号」是这次重设计唯一真正守得住的东西。
 */
import { describe, expect, it } from 'vitest';
import { BLOCK_KINDS, parseBlocks, parseDoc, slugify } from '@/lib/markdownLite';
import { DOCS } from '@/docs';

describe('七种块', () => {
  it('h2 / h3：带锚点 id', () => {
    expect(parseBlocks('## 安装一个 Python')).toEqual([
      { kind: 'h2', id: '安装一个-python', text: '安装一个 Python' },
    ]);
    expect(parseBlocks('### 中文乱码？')).toEqual([
      { kind: 'h3', id: '中文乱码', text: '中文乱码？' },
    ]);
  });

  it('p：连续的行并成一段，行内反引号切成 code 片段', () => {
    expect(parseBlocks('等价于 `python -u x.py`\n就是这样')).toEqual([
      {
        kind: 'p',
        spans: [
          { text: '等价于 ', code: false },
          { text: 'python -u x.py', code: true },
          { text: ' 就是这样', code: false },
        ],
      },
    ]);
  });

  it('ul / ol', () => {
    const [ul] = parseBlocks('- 一\n- 二');
    expect(ul).toEqual({
      kind: 'ul',
      items: [[{ text: '一', code: false }], [{ text: '二', code: false }]],
    });
    const [ol] = parseBlocks('1. 一\n2. 二');
    expect(ol).toEqual({
      kind: 'ol',
      items: [[{ text: '一', code: false }], [{ text: '二', code: false }]],
    });
  });

  it('pre：围栏内原样保留，不做行内解析', () => {
    expect(parseBlocks('```\npython -i -u\n  缩进保留\n```')).toEqual([
      { kind: 'pre', text: 'python -i -u\n  缩进保留' },
    ]);
  });

  it('quote：连续的 > 行并成一条', () => {
    expect(parseBlocks('> 注意\n> 第二行')).toEqual([
      { kind: 'quote', spans: [{ text: '注意 第二行', code: false }] },
    ]);
  });

  it('未闭合的围栏不吞异常：读到文件尾就收工', () => {
    expect(parseBlocks('```\nx = 1')).toEqual([{ kind: 'pre', text: 'x = 1' }]);
  });

  it('两篇真文档里出现的块类型，全都在这七种之内', () => {
    const kinds = new Set(
      Object.values(DOCS).flatMap((doc) => parseBlocks(doc).map((b) => b.kind)),
    );
    for (const kind of kinds) expect(BLOCK_KINDS).toContain(kind);
    expect(BLOCK_KINDS).toHaveLength(7);
  });

  it('不认识的语法降级成正文，绝不丢内容', () => {
    // 表格、粗体、图片都不支持 —— 但它们的字一个都不许消失
    const blocks = parseBlocks('| a | b |\n\n![图](x.png)');
    expect(blocks.every((b) => b.kind === 'p')).toBe(true);
    expect(JSON.stringify(blocks)).toContain('![图](x.png)');
  });
});

describe('parseDoc：# 是标题，## 是一节（也就是一个 Fold）', () => {
  const page = parseDoc('# 标题\n\n开场白\n\n## 甲\n\n甲的正文\n\n### 甲一\n\n## 乙\n');

  it('取出文档标题', () => {
    expect(page.title).toBe('标题');
  });

  it('第一个 ## 之前的块进 intro，不丢', () => {
    expect(page.intro).toEqual([{ kind: 'p', spans: [{ text: '开场白', code: false }] }]);
  });

  it('每个 ## 是一节，h3 归进它所属的节', () => {
    expect(page.sections.map((s) => s.title)).toEqual(['甲', '乙']);
    expect(page.sections[0].blocks.map((b) => b.kind)).toEqual(['p', 'h3']);
    expect(page.sections[1].blocks).toEqual([]);
  });
});

describe('slugify', () => {
  it('小写、空格转连字符、丢掉全角标点，中文原样保留', () => {
    expect(slugify('Gate 与合议')).toBe('gate-与合议');
    expect(slugify('已知限制')).toBe('已知限制');
    expect(slugify('找不到 Python？')).toBe('找不到-python');
  });
});
