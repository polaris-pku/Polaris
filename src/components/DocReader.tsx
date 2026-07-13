import { useEffect, useMemo, useRef, useState } from 'react';
import { Fold } from '@/components/ui/Fold';
import { COLLAPSED_SECTIONS, DOCS } from '@/docs';
import { parseDoc, type DocBlock, type DocSpan } from '@/lib/markdownLite';
import { cn } from '@/lib/utils';

/**
 * 文档阅读器：左 TOC 140px + 正文 396px（13px 中文约 30 字/行，在中文阅读的舒适带里）。
 *
 * 文档里的每个 `##` 就是一个 `Fold` —— **连文档都用界面的折叠语法**。
 * 这不是省事：一个教你「点开折叠看细节」的应用，如果它的帮助页自己用另一套展开方式，
 * 那这套语法就不是语法，只是装饰。
 */
export function DocReader({ topicId, anchor }: { topicId: string; anchor: string | null }) {
  const doc = useMemo(() => parseDoc(DOCS[topicId] ?? ''), [topicId]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  /** 当前滚到哪一节（TOC 高亮）。 */
  const [activeId, setActiveId] = useState<string>(doc.sections[0]?.id ?? '');

  /**
   * 强制展开：`Fold` 的展开态是它自己的内部状态（没有受控 prop），
   * 所以从 TOC / 上下文锚点跳进一个默认收起的节时，靠换 key 重新挂载来把它打开。
   */
  const [forced, setForced] = useState<Record<string, number>>({});

  const jumpTo = (id: string) => {
    setForced((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
    setActiveId(id);
    // 重新挂载在同一帧里发生，滚动要等它挂完
    requestAnimationFrame(() => {
      document.getElementById(`doc-${id}`)?.scrollIntoView({ block: 'start' });
    });
  };

  // 换主题 / 换锚点：跳到锚点，没有锚点就回到顶部
  useEffect(() => {
    if (anchor) {
      jumpTo(anchor);
      return;
    }
    scrollRef.current?.scrollTo({ top: 0 });
    setActiveId(doc.sections[0]?.id ?? '');
    // jumpTo 只依赖 setState，不需要进依赖表
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicId, anchor]);

  // 滚动高亮：取「已经滚过容器顶沿」的最后一节
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const top = el.getBoundingClientRect().top + 8;
      let current = doc.sections[0]?.id ?? '';
      for (const section of doc.sections) {
        const node = document.getElementById(`doc-${section.id}`);
        if (node && node.getBoundingClientRect().top <= top) current = section.id;
      }
      setActiveId(current);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
    };
  }, [doc]);

  return (
    <div className="flex min-h-0 flex-1">
      <nav
        aria-label="目录"
        className="w-[140px] shrink-0 overflow-y-auto border-r border-edge px-2 py-3"
      >
        {doc.sections.map((section) => (
          <button
            key={section.id}
            type="button"
            onClick={() => {
              jumpTo(section.id);
            }}
            className={cn(
              'block w-full truncate rounded-chip px-2 py-1 text-left text-body transition-colors',
              section.id === activeId
                ? 'bg-surface-raised text-fg-primary'
                : 'text-fg-muted hover:text-fg-secondary',
            )}
          >
            {section.title}
          </button>
        ))}
      </nav>

      <div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto">
        {doc.intro.length > 0 && (
          <div className="border-b border-edge bg-surface-panel px-3 py-2">
            {doc.intro.map((block, i) => (
              <BlockView key={i} block={block} />
            ))}
          </div>
        )}

        {doc.sections.map((section) => (
          <div key={section.id} id={`doc-${section.id}`}>
            <Fold
              // 换 key = 重新挂载 = 按新的 defaultOpen 打开（TOC 点击要能撑开默认收起的节）
              key={`${section.id}:${String(forced[section.id] ?? 0)}`}
              id={`doc-fold-${section.id}`}
              title={section.title}
              defaultOpen={
                (forced[section.id] ?? 0) > 0 || !COLLAPSED_SECTIONS.includes(section.title)
              }
            >
              {section.blocks.map((block, i) => (
                <BlockView key={i} block={block} />
              ))}
            </Fold>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 七种块，没有第八种。
 *
 * `pre` / 行内 code 用 `surface-void` 而不是规格里写的 `surface-raised` —— 因为文档正文本身
 * 就活在 Fold 的 D2 里，而 D2 的底色就是 `surface-raised`：底色压底色 = 代码块在文档里直接隐形。
 * 仍然只用既有的四个表面 token，没有新增色阶。
 */
function BlockView({ block }: { block: DocBlock }) {
  switch (block.kind) {
    case 'h3':
      return (
        <h3 id={`doc-${block.id}`} className="mt-3 text-body text-fg-primary first:mt-0">
          {block.text}
        </h3>
      );

    case 'p':
      return (
        <p className="mt-2 text-body text-fg-secondary first:mt-0">
          <Spans spans={block.spans} />
        </p>
      );

    case 'ul':
      return (
        <ul className="mt-2 space-y-1 first:mt-0">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-2 text-body text-fg-secondary">
              <span aria-hidden className="shrink-0 text-fg-faint">
                ·
              </span>
              <span className="min-w-0">
                <Spans spans={item} />
              </span>
            </li>
          ))}
        </ul>
      );

    case 'ol':
      return (
        <ol className="mt-2 space-y-1 first:mt-0">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-2 text-body text-fg-secondary">
              <span aria-hidden className="tabular shrink-0 text-meta text-fg-muted">
                {i + 1}.
              </span>
              <span className="min-w-0">
                <Spans spans={item} />
              </span>
            </li>
          ))}
        </ol>
      );

    case 'pre':
      return (
        <pre className="mt-2 overflow-x-auto rounded-chip border border-edge bg-surface-void px-2 py-1 text-code text-fg-secondary first:mt-0">
          {block.text}
        </pre>
      );

    case 'quote':
      return (
        <blockquote className="mt-2 border-l-2 border-l-human pl-2 text-body text-fg-secondary first:mt-0">
          <Spans spans={block.spans} />
        </blockquote>
      );

    // h2 由 DocReader 提成 Fold 的标题，不会走到这里
    case 'h2':
      return null;
  }
}

function Spans({ spans }: { spans: DocSpan[] }) {
  return (
    <>
      {spans.map((span, i) =>
        span.code ? (
          <code
            key={i}
            className="rounded-chip bg-surface-void px-1 font-mono text-code text-fg-primary"
          >
            {span.text}
          </code>
        ) : (
          <span key={i}>{span.text}</span>
        ),
      )}
    </>
  );
}
