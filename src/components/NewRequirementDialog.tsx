import { useState, type KeyboardEvent } from 'react';
import { FilePlus2, ArrowRight, AlertTriangle } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { useDemoStore } from '@/store/useDemoStore';
import { cn } from '@/lib/utils';

type RunModeChoice = 'single_agent' | 'council';

/** 执行方式说人话（协议词 single_agent / council 不出现在这一屏）。 */
const MODE_CHOICES: { id: RunModeChoice; label: string; desc: string }[] = [
  { id: 'single_agent', label: '单 Agent', desc: '一个 Agent 直接完成需求。' },
  {
    id: 'council',
    label: '多 Agent 合议',
    desc: '两份提案 + 评审 + 综合，选优交付。约 5 次 Agent 调用，费用与时长相应增加。',
  },
];

/**
 * 新建需求 —— **这是新用户的正门**。
 *
 * 所以这一屏里一个协议词都没有：用户要写的是「我想要什么」，不是在填一份规格表单。
 */
export function NewRequirementDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createTask = useDemoStore((s) => s.createTask);
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [criteria, setCriteria] = useState('');
  const [mode, setMode] = useState<RunModeChoice>('single_agent');
  const [error, setError] = useState<string | null>(null);

  const canSubmit = text.trim().length > 0;

  const reset = () => {
    setText('');
    setTitle('');
    setCriteria('');
    setMode('single_agent');
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleCreate = () => {
    if (!canSubmit) return;
    // 提交可能被拒（别的项目还有 run 在跑 —— 绑定工作区会杀掉它）。
    // 被拒时**不要关对话框**：把原因摆在用户眼前，他输入的内容也原样留着。
    const result = createTask(text, title, criteria.split('\n'), mode);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    reset();
    onClose();
  };

  const onTextareaKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl / Cmd + Enter 快捷提交
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleCreate();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} className="max-w-xl">
      <div className="p-6">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-panel bg-command/15 text-command-soft">
            <FilePlus2 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-title text-fg-primary">新建需求</h2>
            <p className="text-body text-fg-muted">说清你想要什么，Agent 会去做。</p>
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-body text-fg-secondary">
            任务标题（可选 · 留空自动生成）
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：权限校验功能"
            className="w-full rounded-panel border border-edge-strong bg-surface-void px-3 py-2 text-body text-fg-primary placeholder:text-fg-faint focus:border-command focus:outline-none focus:ring-1 focus:ring-command/40"
          />
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-body text-fg-secondary">需求描述</label>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onTextareaKeyDown}
            rows={5}
            autoFocus
            placeholder="描述你想实现的需求，例如：为订单接口增加基于角色的权限校验，未授权访问返回 403…"
          />
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-body text-fg-secondary">
            验收标准（可选 · 每行一条）
          </label>
          <Textarea
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
            rows={3}
            placeholder={'未授权访问返回 403\n已有单测全部通过'}
          />
          <p className="mt-1 text-body text-fg-muted">留空则由 Agent 起草一份，随任务一起提交。</p>
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-body text-fg-secondary">执行方式</label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {MODE_CHOICES.map((choice) => {
              const active = mode === choice.id;
              return (
                <button
                  key={choice.id}
                  type="button"
                  onClick={() => {
                    setMode(choice.id);
                  }}
                  className={cn(
                    'rounded-panel border bg-surface-panel p-3 text-left transition-colors',
                    active
                      ? 'border-command/60 ring-1 ring-command/40'
                      : 'border-edge hover:border-edge-strong',
                  )}
                >
                  <div
                    className={cn('text-body', active ? 'text-command-soft' : 'text-fg-primary')}
                  >
                    {choice.label}
                  </div>
                  <p className="mt-0.5 text-body text-fg-muted">{choice.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* 提交被拒（例如别的项目还有 run 在跑）：原因必须摆在用户眼前，且对话框不关 */}
        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-panel border border-human/30 bg-human/5 px-3 py-2">
            <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-human-soft" />
            <p className="whitespace-pre-line text-body text-fg-secondary">{error}</p>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={handleClose}>
            取消
          </Button>
          <Button variant="primary" onClick={handleCreate} disabled={!canSubmit}>
            创建任务 <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
