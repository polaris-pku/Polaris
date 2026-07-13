/**
 * 进度缎带 —— 4 段：受理 / 执行 / 审查 / 交付。
 *
 * 它取代的是画布上那 4 个阶段 chip。那些 chip 身兼二职：「亮 = 已展开」与「LED = 当前阶段」——
 * **两种含义挤在同一个符号里**，所以它们表达的都不清楚。缎带只表状态，不当折叠开关。
 *
 * 8px 的条 + 一行标签。中文标签走 13px（CJK 契约 C1：11px 那一档只承载数字 / ASCII）。
 */
import type { PhaseSegment } from '@/lib/missionLine';
import { cn } from '@/lib/utils';

export function ProgressRibbon({ phases }: { phases: PhaseSegment[] }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-2 gap-1">
        {phases.map((phase) => (
          <Segment key={phase.key} phase={phase} />
        ))}
      </div>
      <div className="flex gap-1">
        {phases.map((phase) => (
          <div
            key={phase.key}
            className={cn(
              'flex flex-1 items-center justify-center gap-1 text-body',
              phase.active ? 'text-command-soft' : 'text-fg-muted',
            )}
          >
            <span>{phase.labelCn}</span>
            {/* k/n 只在当前段出现 —— 别的段给出计数只是噪声 */}
            {phase.active && phase.total > 0 && (
              <span className="tabular text-meta">
                {phase.done}/{phase.total}
              </span>
            )}
            {!phase.active && phase.total > 0 && phase.done === phase.total && (
              <span aria-label="已完成" className="text-meta text-ok">
                ✓
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 一段 = 一个阶段。已完成的部分用 command 填充，剩下的是空槽 —— 没有第三种颜色。 */
function Segment({ phase }: { phase: PhaseSegment }) {
  const ratio = phase.total > 0 ? phase.done / phase.total : 0;
  const percent = Math.round(ratio * 100);
  return (
    <div
      className={cn(
        'relative h-2 flex-1 overflow-hidden rounded-chip bg-surface-raised',
        phase.active && 'ring-2 ring-edge-focus',
      )}
      role="presentation"
    >
      <div
        className="h-full bg-command transition-[width] duration-500"
        style={{ width: `${String(percent)}%` }}
      />
    </div>
  );
}
