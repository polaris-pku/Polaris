/**
 * 记忆面板的公共零件。
 *
 * 这些东西原本在 `SkillMarketPanel` / `MemoryOpsPanel` / `AgentAdminPanel` 里各存一份
 * （`INPUT_CLASS` 三份、`PendingLine` 两份、能力门控三种写法）。拆出全局控制台
 * （`OrgConsolePanel`）时会变成四份，所以在这里收口一次。
 *
 * 收口的只有**真·公共**的部分：能力门控、区块标题、扫描结果卡。各面板自己的业务卡片
 * （技能卡、退休结果卡、缓冲区明细）仍留在各自文件里 —— 它们不共享，搬过来只会让这个
 * 文件变成第二个大杂烩。常量与纯函数在同目录的 `memoryShared.ts`。
 */
import type { ReactNode } from 'react';
import { AlertTriangle, Loader2, type LucideIcon } from 'lucide-react';
import type { MemoryCapabilities, MemoryOperationName } from '@/api/types/memory';
import type { MemoryRetiredReason, RpcRetirementScanResult } from '@/api/types/memory';
import { Badge, type BadgeProps } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { IdChip } from '@/components/ui/IdChip';
import { Panel } from '@/components/ui/Panel';
import { can, LAYER_LABEL, OPERATION_LABEL, ratio, SCAN_ACTION_LABEL } from './memoryShared';

// ── 能力门控 ──

/** 能力未声明可用时的那一行灰字：说清是「后端不给」而不是「界面没做」。 */
export function UnavailableNote({
  capabilities,
  op,
  what,
}: {
  capabilities: MemoryCapabilities | undefined;
  op: MemoryOperationName;
  what: string;
}) {
  if (!capabilities) {
    return <p className="text-body text-fg-muted">{what}：能力清单尚未返回。</p>;
  }
  const capability = capabilities.operations[op];
  if (capability.status === 'available') return null;
  return (
    <p className="text-body text-fg-muted">
      {what}：后端声明不可用
      {capability.reason ? ` · ${capability.reason}` : ''}
      <span className="ml-2 font-mono text-code text-fg-faint">{op}</span>
    </p>
  );
}

export function Gate({
  capabilities,
  op,
  what,
  children,
}: {
  capabilities: MemoryCapabilities | undefined;
  op: MemoryOperationName;
  what: string;
  children: ReactNode;
}) {
  if (can(capabilities, op)) return <>{children}</>;
  return <UnavailableNote capabilities={capabilities} op={op} what={what} />;
}

/** 后端声明为 unavailable 的一组操作：不给按钮，改说一句「为什么没有」。 */
export function CapabilityNotice({
  capabilities,
  names,
}: {
  capabilities: MemoryCapabilities | undefined;
  names: MemoryOperationName[];
}) {
  if (!capabilities) {
    return <p className="text-body text-fg-muted">正在读取后端能力清单…</p>;
  }
  const blocked = names
    .map((name) => ({ name, capability: capabilities.operations[name] }))
    .filter((item) => item.capability?.status !== 'available');
  if (blocked.length === 0) return null;
  return (
    <ul className="space-y-1">
      {blocked.map(({ name, capability }) => (
        <li key={name} className="text-body text-fg-muted">
          {OPERATION_LABEL[name] ?? '该操作'}后端未开放
          <span className="ml-1.5 font-mono text-code text-fg-faint">{name}</span>
          {capability?.reason ? <span> · {capability.reason}</span> : null}
        </li>
      ))}
    </ul>
  );
}

// ── 排版零件 ──

export function SectionHeader({
  icon: Icon,
  title,
  method,
  right,
}: {
  icon: LucideIcon;
  title: string;
  method: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
      <h3 className="shrink-0 text-title text-fg-primary">{title}</h3>
      <span className="truncate font-mono text-code text-fg-faint">{method}</span>
      {right && <div className="ml-auto flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  );
}

/** KeyValue 的兄弟排版，值换成 IdChip —— 机器 ID 不裸奔。 */
export function IdRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3 py-1">
      <span className="w-20 shrink-0 text-body text-fg-muted">{label}</span>
      <IdChip value={value} />
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-panel border border-edge bg-surface-void px-3 py-2">
      <div className="text-body text-fg-muted">{label}</div>
      <div className="tabular text-title text-fg-primary">{value}</div>
    </div>
  );
}

export function Pending({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 text-body text-fg-muted">
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      {text}
    </p>
  );
}

export function TagRow({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <span key={tag} className="rounded-chip border border-edge px-1.5 font-mono text-code">
          {tag}
        </span>
      ))}
    </div>
  );
}

/** 词表命中就只显示中文；没命中才把协议原值作为灰色注解挂在中文标签旁（F2）。 */
export function WireBadge({
  dict,
  tone,
  value,
  fallbackLabel,
}: {
  dict: Record<string, string>;
  tone: Record<string, BadgeProps['variant']>;
  value: string;
  fallbackLabel: string;
}) {
  const label = dict[value];
  if (label) return <Badge variant={tone[value] ?? 'default'}>{label}</Badge>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge>{fallbackLabel}</Badge>
      <span className="font-mono text-code text-fg-faint">{value}</span>
    </span>
  );
}

// ── 退休扫描 ──

/**
 * 退休扫描结果卡。单 Agent 扫描与全量扫描共用。
 *
 * - `onUseReason` 只有单 Agent 那边有意义（把建议原因填进同页的退休表单）；
 *   全量扫描页没有那张表单，不传就不画这颗按钮。
 * - `showRole` 给全量扫描用：一次回来几十条，不标归属根本分不清是谁。
 * - `error` 是 scanAll 的容错占位（该 Agent 扫描失败，结果是 keep/confidence:0），
 *   不摆出来会让人以为它「被评估为保留」。
 */
export function ScanCard({
  scan,
  onUseReason,
  showRole,
}: {
  scan: RpcRetirementScanResult;
  onUseReason?: (reason: MemoryRetiredReason) => void;
  showRole?: boolean;
}) {
  const suggested = scan.suggested_reason;
  return (
    <Panel className="bg-surface-void">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant={scan.action === 'retire' ? 'danger' : scan.action === 'warn' ? 'human' : 'ok'}
        >
          {SCAN_ACTION_LABEL[scan.action] || '未知结论'}
        </Badge>
        <span className="font-mono text-code text-fg-faint">{scan.action}</span>
        <span className="text-body text-fg-muted">
          置信度 <span className="tabular font-mono text-code">{ratio(scan.confidence)}</span>
        </span>
        {showRole && <IdChip value={scan.role_id} label="角色" />}
        <span className="ml-auto">
          <IdChip value={scan.scan_id} label="扫描" />
        </span>
      </div>
      <p className="mt-1 text-body text-fg-muted">{scan.scanned_at || '—'}</p>

      {scan.error && (
        <p className="mt-2 flex items-start gap-2 text-body text-danger-soft">
          <AlertTriangle className="mt-1 h-3.5 w-3.5 shrink-0" />
          {scan.error}
        </p>
      )}

      {scan.reasons.length > 0 && (
        <ul className="mt-2 space-y-1">
          {scan.reasons.map((reason, index) => (
            <li key={`${scan.scan_id}-${String(index)}`} className="text-body text-fg-secondary">
              · {reason}
            </li>
          ))}
        </ul>
      )}

      {scan.layers.length > 0 && (
        <div className="mt-2 space-y-1">
          {scan.layers.map((layer) => (
            <div
              key={`${scan.scan_id}-${layer.layer}`}
              className="flex flex-wrap items-baseline gap-2 border-t border-edge pt-1 text-body text-fg-muted"
            >
              <span className="text-fg-secondary">{LAYER_LABEL[layer.layer] || layer.layer}</span>
              <span className="font-mono text-code text-fg-faint">{layer.layer}</span>
              <span>{SCAN_ACTION_LABEL[layer.action] || layer.action}</span>
              <span className="tabular font-mono text-code">{ratio(layer.confidence)}</span>
              {layer.skipped && <span className="text-human-soft">冷却期内跳过</span>}
              {typeof layer.persona_drift === 'number' && (
                <span>
                  漂移{' '}
                  <span className="tabular font-mono text-code">{ratio(layer.persona_drift)}</span>
                </span>
              )}
              {typeof layer.market_replaceability === 'number' && (
                <span>
                  可替代{' '}
                  <span className="tabular font-mono text-code">
                    {ratio(layer.market_replaceability)}
                  </span>
                </span>
              )}
              {typeof layer.experience_recoverability === 'number' && (
                <span>
                  可恢复{' '}
                  <span className="tabular font-mono text-code">
                    {ratio(layer.experience_recoverability)}
                  </span>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {suggested && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-body text-fg-muted">建议原因</span>
          <span className="font-mono text-code text-fg-faint">{suggested}</span>
          {onUseReason && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onUseReason(suggested);
              }}
            >
              填入退休表单
            </Button>
          )}
        </div>
      )}
    </Panel>
  );
}
