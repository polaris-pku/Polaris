import type { ReactNode } from 'react';
import { Fold } from '@/components/ui/Fold';
import { IdChip } from '@/components/ui/IdChip';
import { KeyValue, KeyValueList } from '@/components/ui/KeyValue';
import { driverLabel, modeLabel, type RunMeta } from '@/lib/runFacts';
import { stageLabel } from '@/lib/runObservability';
import type { RunSnapshot } from '@/api/types/rpc';

/**
 * ⑦「运行信息」—— **全应用唯一能出现机器 ID 的地方。**
 *
 * `COORD · TASK_39DAC07E-…` / `MODE · SINGLE_AGENT` / `DRIVER=ACP-EXTERNAL` 这些以前都焊在主层：
 * UUID 对操作者的信息量精确为 0，它们只在**报 bug 的那一刻**有用。所以它们收进这里，
 * 截断 + hover 全文 + 点击复制，整块还能一键复制成 JSON —— 报 bug 要的是整块，不是一条一条抠。
 */
export function RunInfoFold({
  meta,
  current,
  onOpenEvidence,
}: {
  meta: RunMeta;
  current?: RunSnapshot['current'];
  onOpenEvidence: () => void;
}) {
  const copyAll = () => {
    void navigator.clipboard?.writeText(
      JSON.stringify(
        {
          task_id: meta.taskId,
          run_id: meta.runId,
          mode: meta.mode,
          driver_id: meta.driverId,
          events: meta.eventCount,
          events_by_source: Object.fromEntries(meta.sourceCounts),
          ...(current ? { current } : {}),
          ...(meta.selection ? { artifact_selection: meta.selection } : {}),
        },
        null,
        2,
      ),
    );
  };

  /** `coordinator 12 · agent 4 · driver 3` —— 报 bug 时一眼看出哪条链路没动静。 */
  const sourceLine = meta.sourceCounts
    .map(([source, count]) => `${source} ${String(count)}`)
    .join(' · ');

  return (
    <Fold
      id="fold-run-info"
      title="运行信息"
      meta={`${String(meta.eventCount)} events`}
      evidence={{ count: meta.eventCount, onOpen: onOpenEvidence }}
    >
      <KeyValueList onCopyAll={copyAll}>
        <IdRow k="任务 ID" value={meta.taskId} />
        <IdRow k="运行 ID" value={meta.runId} />
        {current?.cursor && <KeyValue k="当前阶段" v={stageLabel(current.cursor)} />}
        {current?.invocation_id && <IdRow k="阶段调用" value={current.invocation_id} />}
        {current?.stage_started_at && <KeyValue k="阶段开始" v={current.stage_started_at} mono />}
        {meta.mode && <KeyValue k="模式" v={`${modeLabel(meta.mode)}（${meta.mode}）`} />}
        {meta.driverId && (
          <KeyValue k="执行器" v={`${driverLabel(meta.driverId)}（${meta.driverId}）`} />
        )}
        <KeyValue k="事件数" v={String(meta.eventCount)} />
        {sourceLine && <KeyValue k="事件分布" v={sourceLine} mono />}
        {meta.selection && (
          <KeyValue
            k="产物选择"
            v={`${meta.selection.mode} · 选中 ${String(meta.selection.selectedCount)} 个`}
            mono
          />
        )}
      </KeyValueList>
    </Fold>
  );
}

/** KeyValue 的同款栅格，值换成可复制的 IdChip。 */
function IdRow({ k, value }: { k: string; value: string }): ReactNode {
  return (
    <div className="flex items-baseline gap-3 py-1">
      <span className="w-20 shrink-0 text-body text-fg-muted">{k}</span>
      <IdChip value={value} />
    </div>
  );
}
