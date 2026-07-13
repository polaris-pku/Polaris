import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ChevronDown, ChevronRight, X } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { buildEventRows, capRows, filterRows, type EventStreamRow } from '@/lib/eventStream';
import { cn } from '@/lib/utils';
import { selectActiveLiveRun, useDemoStore } from '@/store/useDemoStore';

/**
 * 事件流频道（L3）—— **全应用唯一渲染原始文本的区域**。
 *
 * 这里是三处历史转储的唯一替代品（LiveRunPanel 的事件 type 列表 / NodeInspector 的
 * raw key-value / 泳道节点卡的悬浮面板，均已删除）。唯一性不靠自律，靠结构：
 * 别处**没有**渲染 event.type / source / payload 的地方，design-guard 的第 15 条
 * 也只对这个文件开了口子。
 *
 * 入口只有一个（F3）：每个 Fold 的 D2 最后一行 `原始事件 · N 条 ↗` → `openEvidence(stepId)`。
 * 状态栏的事件数点击 → `openDock('events')`（不带过滤）。
 */
export function EventStreamChannel() {
  const liveRun = useDemoStore(selectActiveLiveRun);
  const evidenceStepId = useDemoStore((s) => s.evidenceStepId);
  const openEvidence = useDemoStore((s) => s.openEvidence);

  const timeline = liveRun?.timeline;

  // 建行 + 过滤 + 截断。timeline 每来一条事件就变一次，memo 掉分组开销。
  const allRows = useMemo(() => buildEventRows(timeline ?? []), [timeline]);
  const { rows, hidden } = useMemo(
    () => capRows(filterRows(allRows, evidenceStepId)),
    [allRows, evidenceStepId],
  );

  const stepLabel = evidenceStepId
    ? (allRows.find((r) => r.stepId === evidenceStepId)?.stepLabel ?? '')
    : '';

  return (
    <div className="flex h-full flex-col bg-surface-void">
      <header className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
        <span className="callsign text-micro text-fg-muted">EVENTS</span>
        <span className="text-body text-fg-secondary">
          {rows.length} 条{evidenceStepId ? '（已过滤）' : ''}
        </span>

        {evidenceStepId && (
          <button
            type="button"
            onClick={() => openEvidence(null)}
            className="flex items-center gap-1 rounded-chip border border-edge-strong px-2 py-0.5 text-body text-fg-secondary hover:border-command hover:text-fg-primary"
            title="清除步骤过滤，显示本次 run 的全部事件"
          >
            <span>{stepLabel || '当前步骤'}</span>
            <X className="h-3 w-3" aria-hidden />
          </button>
        )}
      </header>

      {!liveRun ? (
        <EmptyState
          icon={Activity}
          title="还没有事件"
          hint="提交一条需求后，后端推来的每一条原始事件都会在这里出现。"
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Activity}
          title={evidenceStepId ? '这一步还没有原始事件' : '还没有事件'}
          hint={
            evidenceStepId
              ? '这一步的事件还没到达。可以清除过滤，看本次 run 的全部事件。'
              : '后端还没有推来事件。'
          }
        />
      ) : (
        <EventRowList rows={rows} hidden={hidden} />
      )}
    </div>
  );
}

/** 事件行列表。新事件到达时自动跟随到底部 —— 但只在用户本来就贴着底部时（不抢滚动）。 */
function EventRowList({ rows, hidden }: { rows: EventStreamRow[]; hidden: number }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [rows.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    // 距底 24px 以内算「贴着底部」——用户往上翻看历史时就不再自动跟随。
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  return (
    <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
      {hidden > 0 && (
        <p className="px-2 py-1 text-body text-fg-faint">
          较早的 {hidden} 条已省略，只显示最新的 {rows.length} 条。
        </p>
      )}
      <ol>
        {rows.map((row) => (
          <EventRow key={row.eventId} row={row} />
        ))}
      </ol>
    </div>
  );
}

/**
 * 一行 = `seq · time · type · source`，可展开看 payload 原文。
 *
 * 这里的 type / source / payload 全是**后端原文**，不做人话化 —— 人话是 L1 的活，
 * 结构是 L2 的活，L3 只说协议（F2）。
 */
function EventRow({ row }: { row: EventStreamRow }) {
  const [open, setOpen] = useState(false);
  const expandable = row.payload !== '';

  return (
    <li>
      <button
        type="button"
        disabled={!expandable}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-baseline gap-3 rounded-chip px-2 py-1 text-left',
          expandable ? 'hover:bg-surface-raised' : 'cursor-default',
        )}
      >
        <span className="flex w-4 shrink-0 justify-center self-center text-fg-faint">
          {expandable ? (
            open ? (
              <ChevronDown className="h-3 w-3" aria-hidden />
            ) : (
              <ChevronRight className="h-3 w-3" aria-hidden />
            )
          ) : null}
        </span>
        <span className="tabular w-8 shrink-0 text-right text-meta text-fg-faint">{row.seq}</span>
        <span className="tabular shrink-0 text-code text-fg-muted">{row.time}</span>
        <span className="min-w-0 flex-1 truncate text-code text-fg-primary">{row.type}</span>
        {row.stepLabel && (
          <span className="shrink-0 truncate text-body text-fg-faint">{row.stepLabel}</span>
        )}
        <span className="w-20 shrink-0 truncate text-right text-meta text-fg-muted">
          {row.source}
        </span>
      </button>

      {open && expandable && (
        <pre className="mx-2 mb-1 overflow-x-auto rounded-chip bg-surface-raised px-3 py-2 text-code text-fg-secondary">
          {row.payload}
        </pre>
      )}
    </li>
  );
}
