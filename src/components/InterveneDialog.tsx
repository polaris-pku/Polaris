import { useState } from 'react';
import { Hand, Check } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { useDemoStore } from '@/store/useDemoStore';
import { DEFAULT_INTERVENE_TEXT } from '@/data/deliveryReport';
import type { InterventionScope } from '@/types';
import { cn } from '@/lib/utils';

const scopeOptions: { value: InterventionScope; label: string; desc: string }[] = [
  {
    value: 'current_step',
    label: '仅影响当前步骤',
    desc: '只对当前 Work 步骤生效，不影响后续。',
  },
  {
    value: 'current_agent',
    label: '影响当前 Agent 后续执行',
    desc: 'Coding Agent 后续步骤都会遵循该规则。',
  },
  {
    value: 'whole_workflow',
    label: '影响整个 Workflow',
    desc: '同步给 Coding / Test / Security 等所有相关 Agent。',
  },
  {
    value: 'project_rule',
    label: '保存为项目长期规则',
    desc: '沉淀为项目级规则，未来任务自动继承。',
  },
];

const AFFECTED_AGENTS = ['Coding Agent', 'Test Agent', 'Security Audit Agent'];

export function InterveneDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const addInterventionRule = useDemoStore((s) => s.addInterventionRule);
  const [text, setText] = useState(DEFAULT_INTERVENE_TEXT);
  const [scope, setScope] = useState<InterventionScope>('whole_workflow');

  const handleConfirm = () => {
    addInterventionRule({
      text: text.trim() || DEFAULT_INTERVENE_TEXT,
      scope,
      affectedAgents: AFFECTED_AGENTS,
    });
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} className="max-w-xl">
      <div className="p-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-human/15 text-human shadow-glow-human">
            <Hand className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-base font-semibold text-white">
              Intervene · N7 Executing
            </h2>
            <p className="text-xs text-slate-500">将补充信息结构化注入到执行中的 Driver / Agent</p>
          </div>
        </div>

        <div className="mt-5">
          <label className="callsign mb-1.5 block text-[9px] text-slate-400">
            介入内容 · DIRECTIVE
          </label>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="请输入要注入的业务规则或补充说明…"
          />
        </div>

        <div className="mt-5">
          <label className="callsign mb-2 block text-[9px] text-slate-400">作用范围 · SCOPE</label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {scopeOptions.map((opt) => {
              const active = scope === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setScope(opt.value)}
                  className={cn(
                    'rounded-md border p-3 text-left transition-all',
                    active
                      ? 'border-human/70 bg-human/10 ring-1 ring-human/40'
                      : 'border-line-bright bg-ink-900/50 hover:border-slate-500',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        'text-sm font-medium',
                        active ? 'text-human-soft' : 'text-slate-200',
                      )}
                    >
                      {opt.label}
                    </span>
                    {active && <Check className="h-4 w-4 text-human" />}
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{opt.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="warning" onClick={handleConfirm}>
            确认注入规则
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
