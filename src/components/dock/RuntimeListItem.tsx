import type { ReactNode } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatBytes, installPhaseLabel, type PyProgress } from '@/lib/pythonFormat';

/**
 * 运行时列表的一行：既用来渲染「已装好的解释器」，也用来渲染「可以一键装的版本」。
 *
 * 两者形状不同（一个有 displayPath，一个有下载体积），但在用户眼里是同一份清单上的两类行 ——
 * 所以是一个组件、一个 union，不是两个各自长歪的组件。
 */
export type RuntimeRow =
  | { kind: 'installed'; runtime: PyRuntime }
  | { kind: 'catalog'; item: PyCatalogItem };

export function RuntimeListItem({
  row,
  selected = false,
  progress = null,
  onSelect,
  actions,
}: {
  row: RuntimeRow;
  selected?: boolean;
  /** 正在装的那一行才有；2px 进度条压在行下沿，**不是**一个居中的大 spinner */
  progress?: PyProgress | null;
  onSelect?: () => void;
  actions?: ReactNode;
}) {
  const installed = row.kind === 'installed';
  const failed = progress?.phase === 'error';
  const busy = !!progress && progress.phase !== 'done' && progress.phase !== 'error';

  const title = installed
    ? `Python ${row.runtime.version}`
    : `Python ${row.item.version}${row.item.recommended ? ' · 推荐' : ''}`;

  // 副行：装好的说「它在哪」（manual 那条尤其必须明文可见）；没装的说「要下多大」。
  const subtitle = installed
    ? row.runtime.displayPath
    : row.item.unavailable
      ? '此平台没有可下载的版本'
      : `下载约 ${formatBytes(row.item.downloadBytes)} · 装完约 ${formatBytes(row.item.installedBytes)}`;

  const clickable = installed && !!onSelect;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-panel border px-3 py-2 transition-colors',
        failed
          ? 'border-danger/40 bg-danger/5'
          : selected
            ? 'border-command/40 bg-surface-raised'
            : 'border-edge bg-surface-panel',
        clickable && !selected && 'hover:border-edge-strong',
      )}
    >
      <div className="flex items-center gap-3">
        {/* 选中标记只占一个固定槽位，选中与否行不跳动 */}
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          {installed &&
            (selected ? (
              <Check className="h-4 w-4 text-command" aria-hidden />
            ) : (
              <button
                type="button"
                onClick={onSelect}
                title="选用这个解释器"
                className="h-3 w-3 rounded-full border border-edge-strong transition-colors hover:border-command"
              />
            ))}
          {busy && <Loader2 className="h-4 w-4 animate-spin text-command" aria-hidden />}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                'truncate text-title',
                selected ? 'text-fg-primary' : 'text-fg-secondary',
              )}
            >
              {title}
            </span>
            {installed && (
              <span className="shrink-0 text-body text-fg-muted">
                {row.runtime.source === 'managed'
                  ? 'Polaris 托管'
                  : row.runtime.source === 'system'
                    ? '系统安装'
                    : '手动指定'}
              </span>
            )}
          </div>
          <p
            className={cn('truncate font-mono text-code', failed ? 'text-danger' : 'text-fg-muted')}
            title={subtitle}
          >
            {progress ? installPhaseLabel(progress) : subtitle}
          </p>
        </div>

        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>

      {/* 2px 进度条压在行下沿。相位名已经在副行上写着了 —— 条只负责「它还在动」 */}
      {busy && (
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-surface-void">
          <div
            className="h-full bg-command transition-all"
            style={{ width: `${String(Math.max(0, Math.min(100, progress.percent)))}%` }}
          />
        </div>
      )}
    </div>
  );
}
