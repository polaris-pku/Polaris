import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { DocReader } from '@/components/DocReader';
import { Button } from '@/components/ui/Button';
import { parseHelpTopic } from '@/docs';
import { HELP_TOPICS } from '@/lib/glossary';
import { cn } from '@/lib/utils';
import { useDemoStore } from '@/store/useDemoStore';

/**
 * 帮助抽屉：App 级、右侧、560px、**没有遮罩**、Esc 关闭。
 *
 * 为什么不是 modal：读文档时最常做的动作是**对照界面** —— 背后的 run 要继续跑、终端要继续输出。
 * modal 把界面盖住，等于逼用户「读一句 → 关掉 → 试一下 → 再打开」。
 * 为什么不是一个 Tab：Tab 要动 `PageKey` / `closeFile()` / checkpoint 载荷，那是另一个项目。
 *
 * 挂载点在 `App.tsx`（`ProjectLauncher` 与 `AppShell` **之上**）—— 这样它在每一屏都能开。
 */
export function HelpDrawer() {
  const open = useDemoStore((s) => s.helpOpen);
  const topic = useDemoStore((s) => s.helpTopic);
  const closeHelp = useDemoStore((s) => s.closeHelp);

  const { topicId, anchor } = parseHelpTopic(topic);
  /** 抽屉里换页签只是本地阅读位置，不该回写 store（store 里那个是「从哪儿进来的」）。 */
  const [activeTopic, setActiveTopic] = useState(topicId);

  // 外部换了主题（侧栏 / 状态栏 / 上下文入口 / 原生菜单）→ 跟着换
  useEffect(() => {
    setActiveTopic(topicId);
  }, [topicId, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeHelp();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open, closeHelp]);

  if (!open) return null;

  return (
    <aside
      role="dialog"
      aria-label="帮助"
      className="fixed inset-y-0 right-0 z-50 flex w-[560px] animate-fade-in flex-col border-l border-edge-strong bg-surface-panel shadow-modal"
    >
      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-edge px-2">
        {HELP_TOPICS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setActiveTopic(t.id);
            }}
            className={cn(
              'rounded-chip px-2 py-1 text-title transition-colors',
              t.id === activeTopic
                ? 'bg-surface-raised text-fg-primary'
                : 'text-fg-muted hover:text-fg-secondary',
            )}
          >
            {t.title}
          </button>
        ))}
        <span className="flex-1" />
        <Button variant="ghost" size="icon" aria-label="关闭帮助" onClick={closeHelp}>
          <X className="h-4 w-4" />
        </Button>
      </header>

      <DocReader topicId={activeTopic} anchor={activeTopic === topicId ? anchor : null} />
    </aside>
  );
}
