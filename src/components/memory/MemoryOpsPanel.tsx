import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Database,
  Inbox,
  Loader2,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  Star,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { memoryApi } from '@/api/memory';
import type {
  MemoryAgentStatus,
  MemoryCapabilities,
  MemoryEffectiveness,
  MemoryExperienceWritePatch,
  MemoryExtractionStatus,
  MemoryOperationName,
  MemorySearchOptions,
  MemoryUserRating,
  MemoryMaintenanceEvidence,
  RpcBufferState,
  RpcDeadLetterEntry,
  RpcExperienceView,
  RpcMemoryOverview,
  RpcMemorySearchResult,
  RpcPendingBuffer,
  RpcReindexResult,
  RpcUserRatingResult,
} from '@/api/types/memory';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Fold } from '@/components/ui/Fold';
import { IdChip } from '@/components/ui/IdChip';
import { KeyValue } from '@/components/ui/KeyValue';
import { Panel } from '@/components/ui/Panel';
import { Textarea } from '@/components/ui/Textarea';

/**
 * 记忆运维面板 —— 总览 / 检索 / 经验 / 缓冲区四块，覆盖 9 条此前前端从没调过的 memory RPC。
 *
 * 三条约束，都是从后端契约倒推出来的，不是排版偏好：
 *  1. **入口按 capabilities 声明渲染。** `memory.getCapabilities` 会逐个操作告诉你
 *     available / unavailable + 原因（缺 repository、缺 embedding、缺生命周期端口）。
 *     不可用时这里画一行灰字说明理由，而不是画一个按下去必然 -32603 的按钮。
 *  2. **后端给什么展示什么。** 还没回来的字段渲染成待取/未给出，不塞占位值 ——
 *     这是一块运维面板，编出来的数字比空白危险得多。
 *  3. **重试的目标 seq 必须先说清再开火。** `memory.retryExtraction` 会把死信恢复成
 *     pending 并重新入队，点错一条就是把一份别人的报告重新跑一遍，所以走二次确认，
 *     确认文案里把 seq / task_id / 失败原因原样念出来。
 */

export interface MemoryPanelProps {
  roleId: string;
  capabilities: MemoryCapabilities | undefined;
  onError: (message: string) => void;
  /** 任何写操作之后调用，让父级重新拉取它自己那份数据 */
  onChanged: () => void;
}

const INPUT_CLASS =
  'w-full rounded-panel border border-edge-strong bg-surface-void px-3 py-2 text-body text-fg-primary placeholder:text-fg-faint focus:border-command focus:outline-none focus:ring-1 focus:ring-command/40';

/** Agent 生命周期状态的人话（`AgentStatusSchema`）。 */
const AGENT_STATUS_LABEL: Record<MemoryAgentStatus, string> = {
  created: '已创建',
  active: '活跃',
  idle: '空闲',
  draining: '收尾中',
  retired: '已退休',
};

/**
 * 评分档位的人话，括号里是后端 `CONFIDENCE_DELTA` 会施加到该任务派生经验上的置信度增量
 * （services/feedback.ts）。这不是提示语，是这次点击的真实后果。
 */
const RATING_CHOICES: { value: MemoryUserRating; label: string; delta: string }[] = [
  { value: 'resolved', label: '已解决', delta: '置信度 +0.05' },
  { value: 'partially_resolved', label: '部分解决', delta: '置信度不变' },
  { value: 'unresolved', label: '未解决', delta: '置信度 -0.1' },
  { value: 'not_rated', label: '不予评分', delta: '置信度不变' },
];

const EXTRACTION_STATUS_LABEL: Record<MemoryExtractionStatus, string> = {
  pending: '待提取',
  processing: '提取中',
  processed: '已提取',
  dead_letter: '死信',
};

/** 维护证据的状态（`BMemoryMaintenanceEvidence.status`）。 */
const MAINTENANCE_STATUS_LABEL: Record<MemoryMaintenanceEvidence['status'], string> = {
  scheduled: '已入队',
  running: '执行中',
  completed: '已完成',
  skipped: '已跳过',
  failed: '失败',
};

const EFFECTIVENESS_LABEL: Record<MemoryEffectiveness, string> = {
  fully_effective: '完全有效',
  partially_effective: '部分有效',
  ineffective: '无效',
  not_applicable: '不适用',
};

/** 经验类型；后端 DTO 上是裸 string，所以只翻译认得的，认不出就原样显示。 */
const EXPERIENCE_TYPE_LABEL: Record<string, string> = {
  positive: '正经验',
  negative: '负经验',
};

const can = (capabilities: MemoryCapabilities | undefined, op: MemoryOperationName): boolean =>
  capabilities?.operations[op].status === 'available';

/** 正整数；空串 / 非法值一律当没填，交给后端默认值。 */
function parsePositiveInt(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/** [0,1] 区间的小数；后端 zod 就是这个范围，越界的值不必送出去挨一次 -32602。 */
function parseUnitFloat(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined;
}

/**
 * RPC 边界是不可信 JSON —— `similarity` 是后端检索时附加的，`confidence` / `avg_confidence`
 * 在老数据与降级投影里都可能缺席。对可能不存在的值直接 `.toFixed()` 会当场抛异常白屏。
 */
function fixed3(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : '—';
}

/** 同上：计数类字段缺席时 `String(undefined)` 会把「undefined」印到界面上。 */
function intText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '后端未给出';
}

function splitTags(raw: string): string[] {
  return raw
    .split(/[,，\s]+/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

/** 能力未声明可用时的那一行灰字：说清是「后端不给」而不是「界面没做」。 */
function UnavailableNote({
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

function Gate({
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

function SectionHeader({
  icon: Icon,
  title,
  method,
  right,
}: {
  icon: typeof Database;
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
function IdRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3 py-1">
      <span className="w-20 shrink-0 text-body text-fg-muted">{label}</span>
      <IdChip value={value} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-panel border border-edge bg-surface-void px-3 py-2">
      <div className="text-body text-fg-muted">{label}</div>
      <div className="tabular text-title text-fg-primary">{value}</div>
    </div>
  );
}

function Pending({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 text-body text-fg-muted">
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      {text}
    </p>
  );
}

export function MemoryOpsPanel({ roleId, capabilities, onError, onChanged }: MemoryPanelProps) {
  const fail = useCallback(
    (reason: unknown) => {
      onError(reason instanceof Error ? reason.message : String(reason));
    },
    [onError],
  );

  /** 自己发起的写操作要让自己这几块也重新取一遍，同时把父级也叫醒。 */
  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => {
    setRevision((n) => n + 1);
    onChanged();
  }, [onChanged]);

  // ── 总览 ──
  const overviewAvailable = can(capabilities, 'get_overview');
  const [overview, setOverview] = useState<RpcMemoryOverview>();
  const [overviewLoading, setOverviewLoading] = useState(false);

  // ── 检索 ──
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState('5');
  const [minSimilarity, setMinSimilarity] = useState('');
  const [includeSkills, setIncludeSkills] = useState(true);
  const [includeExperiences, setIncludeExperiences] = useState(true);
  const [searchResult, setSearchResult] = useState<RpcMemorySearchResult>();
  const [searching, setSearching] = useState(false);

  // ── 经验 ──
  const listExperiencesAvailable = can(capabilities, 'list_experiences');
  const [experiences, setExperiences] = useState<RpcExperienceView[]>();
  const [experiencesLoading, setExperiencesLoading] = useState(false);
  const [keywordDraft, setKeywordDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const [editing, setEditing] = useState<RpcExperienceView>();
  const [deleting, setDeleting] = useState<RpcExperienceView>();
  const [deletingBusy, setDeletingBusy] = useState(false);
  /** 正在晋升的经验 id；同一时刻只允许一条，避免连点晋升出两条重复技能。 */
  const [promotingId, setPromotingId] = useState<string>();

  // ── 重建索引 ──
  const [reindexScope, setReindexScope] = useState<'role' | 'all'>('role');
  const [reindexForce, setReindexForce] = useState(false);
  const [reindexBusy, setReindexBusy] = useState(false);
  const [reindexResult, setReindexResult] = useState<RpcReindexResult>();

  const [sourceTaskId, setSourceTaskId] = useState('');
  const [sourceExperiences, setSourceExperiences] = useState<RpcExperienceView[]>();
  const [sourceLoading, setSourceLoading] = useState(false);

  const [rateTaskId, setRateTaskId] = useState('');
  const [rating, setRating] = useState<MemoryUserRating>('resolved');
  const [ratingNote, setRatingNote] = useState('');
  const [ratingBusy, setRatingBusy] = useState(false);
  const [ratingResult, setRatingResult] = useState<RpcUserRatingResult>();

  // ── 缓冲区 ──
  const bufferStateAvailable = can(capabilities, 'get_buffer_state');
  const pendingBufferAvailable = can(capabilities, 'get_pending_buffer');
  const [bufferState, setBufferState] = useState<RpcBufferState>();
  const [bufferLoading, setBufferLoading] = useState(false);
  const [openSeq, setOpenSeq] = useState<number>();
  /** undefined = 还没取；null = 后端把 buffer 键整个丢了（该 seq 已不在 pending 目录）。 */
  const [pendingBuffer, setPendingBuffer] = useState<RpcPendingBuffer | null>();
  const [pendingLoading, setPendingLoading] = useState(false);
  const [retryTarget, setRetryTarget] = useState<RpcDeadLetterEntry>();
  const [retrying, setRetrying] = useState(false);
  const [retryEvidence, setRetryEvidence] = useState<MemoryMaintenanceEvidence>();

  // 换 Agent 就把所有「这一个角色的一次查看」清干净，避免把上一个人的结果读成这一个人的。
  useEffect(() => {
    setSearchResult(undefined);
    setSourceExperiences(undefined);
    setRatingResult(undefined);
    setOpenSeq(undefined);
    setPendingBuffer(undefined);
    setRetryEvidence(undefined);
    setKeywordDraft('');
    setKeyword('');
  }, [roleId]);

  useEffect(() => {
    if (!overviewAvailable) {
      setOverview(undefined);
      return;
    }
    let active = true;
    setOverviewLoading(true);
    void memoryApi
      .getOverview()
      .then((result) => {
        if (active) setOverview(result.overview);
      })
      .catch((reason: unknown) => {
        if (active) fail(reason);
      })
      .finally(() => {
        if (active) setOverviewLoading(false);
      });
    return () => {
      active = false;
    };
  }, [overviewAvailable, revision, fail]);

  useEffect(() => {
    if (!roleId || !listExperiencesAvailable) {
      setExperiences(undefined);
      return;
    }
    let active = true;
    setExperiencesLoading(true);
    void memoryApi
      .listExperiences(roleId, keyword ? { keyword } : {})
      .then((result) => {
        if (active) setExperiences(result.experiences);
      })
      .catch((reason: unknown) => {
        if (active) fail(reason);
      })
      .finally(() => {
        if (active) setExperiencesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [roleId, listExperiencesAvailable, keyword, revision, fail]);

  useEffect(() => {
    if (!roleId || !bufferStateAvailable) {
      setBufferState(undefined);
      return;
    }
    let active = true;
    setBufferLoading(true);
    void memoryApi
      .getBufferState(roleId)
      .then((result) => {
        if (active) setBufferState(result.state);
      })
      .catch((reason: unknown) => {
        if (active) fail(reason);
      })
      .finally(() => {
        if (active) setBufferLoading(false);
      });
    return () => {
      active = false;
    };
  }, [roleId, bufferStateAvailable, revision, fail]);

  useEffect(() => {
    if (!roleId || openSeq === undefined || !pendingBufferAvailable) {
      setPendingBuffer(undefined);
      return;
    }
    let active = true;
    setPendingLoading(true);
    void memoryApi
      .getPendingBuffer(roleId, openSeq)
      .then((result) => {
        // 查不到那一条时后端返回的是 `{}`，不是错误 —— 这里落成 null，界面照实说。
        if (active) setPendingBuffer(result.buffer ?? null);
      })
      .catch((reason: unknown) => {
        if (active) fail(reason);
      })
      .finally(() => {
        if (active) setPendingLoading(false);
      });
    return () => {
      active = false;
    };
  }, [roleId, openSeq, pendingBufferAvailable, fail]);

  const runSearch = async () => {
    if (!roleId || searching || query.trim() === '') return;
    setSearching(true);
    const parsedTopK = parsePositiveInt(topK);
    const parsedMinSimilarity = parseUnitFloat(minSimilarity);
    const options: MemorySearchOptions = {
      ...(parsedTopK !== undefined ? { top_k: parsedTopK } : {}),
      ...(parsedMinSimilarity !== undefined ? { min_similarity: parsedMinSimilarity } : {}),
      // 后端只有显式 false 才抑制该类结果，所以勾上时干脆不传。
      ...(includeSkills ? {} : { include_skills: false }),
      ...(includeExperiences ? {} : { include_experiences: false }),
    };
    try {
      // searchMemory 是唯一没有信封的 memory 方法：result 顶层就是 { skills, experiences }。
      setSearchResult(await memoryApi.searchMemory(roleId, query.trim(), options));
    } catch (reason) {
      fail(reason);
    } finally {
      setSearching(false);
    }
  };

  const lookupBySourceTask = async () => {
    if (sourceLoading || sourceTaskId.trim() === '') return;
    setSourceLoading(true);
    try {
      const result = await memoryApi.listExperiencesBySourceTask(sourceTaskId.trim());
      setSourceExperiences(result.experiences);
    } catch (reason) {
      fail(reason);
    } finally {
      setSourceLoading(false);
    }
  };

  const submitRating = async () => {
    if (!roleId || ratingBusy || rateTaskId.trim() === '') return;
    setRatingBusy(true);
    try {
      const result = await memoryApi.rateTask(
        roleId,
        rateTaskId.trim(),
        rating,
        ratingNote.trim() || undefined,
      );
      setRatingResult(result.rating);
      bump();
    } catch (reason) {
      fail(reason);
    } finally {
      setRatingBusy(false);
    }
  };

  /**
   * 显式晋升一条经验为待审核技能。
   *
   * 按钮只在 `type==='positive'` 且 `promoted_to` 为空时出现 —— 后端对这两条都会抛错，
   * 与其让用户点了才看见「Only positive experiences can be promoted」，不如先不给按钮。
   * 成功后 bump()：经验会被回写 `promoted_to`，列表要重取才看得出来。
   */
  const runPromote = async (experience: RpcExperienceView) => {
    if (!roleId || promotingId) return;
    setPromotingId(experience.id);
    try {
      await memoryApi.promoteExperience(roleId, experience.id);
      bump();
    } catch (reason) {
      fail(reason);
    } finally {
      setPromotingId(undefined);
    }
  };

  /**
   * 重建向量索引。这是**同步且可能很慢**的一次 RPC —— 后端顺序遍历每条记录逐个 embed，
   * 没有进度事件，全量重建时按记录数线性耗时。所以按钮期间整段禁用，不做超时兜底。
   */
  const runReindex = async () => {
    if (reindexBusy) return;
    setReindexBusy(true);
    setReindexResult(undefined);
    try {
      const result = await memoryApi.reindex({
        ...(reindexScope === 'role' ? { roleId } : {}),
        ...(reindexForce ? { force: true } : {}),
      });
      setReindexResult(result.reindex);
      bump();
    } catch (reason) {
      fail(reason);
    } finally {
      setReindexBusy(false);
    }
  };

  const confirmDelete = async (experience: RpcExperienceView) => {
    if (deletingBusy) return;
    setDeletingBusy(true);
    try {
      await memoryApi.deleteExperience(roleId, experience.id);
      bump();
    } catch (reason) {
      fail(reason);
    } finally {
      setDeletingBusy(false);
    }
  };

  const confirmRetry = async (seq: number) => {
    if (!roleId || retrying) return;
    setRetrying(true);
    try {
      const result = await memoryApi.retryExtraction(roleId, seq);
      setRetryEvidence(result.maintenance);
      bump();
    } catch (reason) {
      fail(reason);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* ── 1 · 总览 ── */}
      <Panel>
        <SectionHeader
          icon={Database}
          title="记忆总览"
          method="memory.getOverview"
          right={
            overviewAvailable ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setRevision((n) => n + 1);
                }}
                disabled={overviewLoading}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                刷新
              </Button>
            ) : undefined
          }
        />
        <Gate capabilities={capabilities} op="get_overview" what="记忆总览">
          {overviewLoading && !overview ? (
            <Pending text="正在统计全局记忆…" />
          ) : overview ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Stat label="Agent 总数" value={String(overview.agents.total)} />
                <Stat label="技能总数" value={String(overview.skills.total)} />
                <Stat label="待审核技能" value={String(overview.skills.pending_review)} />
                <Stat label="市场在架" value={String(overview.skills.in_market)} />
                <Stat label="经验总数" value={String(overview.experiences.total)} />
                <Stat label="缓冲区待提取" value={String(overview.buffer.pending)} />
                <Stat label="缓冲区死信" value={String(overview.buffer.dead_letters)} />
                <Stat label="平均置信度" value={fixed3(overview.quality.avg_confidence)} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body text-fg-muted">状态分布</span>
                {Object.entries(overview.agents.by_status).map(([status, count]) => (
                  <Badge key={status}>
                    {AGENT_STATUS_LABEL[status as MemoryAgentStatus] ?? status}
                    <span className="tabular font-mono text-code text-fg-faint">{count ?? 0}</span>
                  </Badge>
                ))}
                {Object.keys(overview.agents.by_status).length === 0 && (
                  <span className="text-body text-fg-muted">后端未给出任何状态计数。</span>
                )}
              </div>
              <p className="text-body text-fg-muted">
                总览是全局口径，跨所有 Agent 聚合，不随左侧选中的角色变化。
              </p>
            </div>
          ) : (
            <p className="text-body text-fg-muted">总览尚未取回。</p>
          )}
        </Gate>
      </Panel>

      {/* ── 1.5 · 重建向量索引 ── */}
      <Panel>
        <SectionHeader icon={RefreshCw} title="重建向量索引" method="memory.reindex" />
        <Gate capabilities={capabilities} op="reindex" what="重建向量索引">
          <div className="space-y-3">
            <p className="text-body text-fg-muted">
              换了 embedding 模型之后，库里存量的向量还是旧模型算的，拿它跟新模型的 query
              比相似度没有意义。后端不会自动重建，这里是唯一入口。
            </p>
            {capabilities && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body text-fg-muted">当前 provider</span>
                <Badge
                  variant={
                    capabilities.embedding.provider === 'HashEmbeddingProvider' ? 'human' : 'ok'
                  }
                >
                  {capabilities.embedding.provider}
                </Badge>
                {capabilities.embedding.model && (
                  <span className="font-mono text-code text-fg-faint">
                    {capabilities.embedding.model}
                  </span>
                )}
                <span className="text-body text-fg-muted">
                  维度 <span className="tabular">{intText(capabilities.embedding.dimensions)}</span>
                </span>
              </div>
            )}
            {capabilities?.embedding.provider === 'HashEmbeddingProvider' && (
              <p className="text-body text-human-soft">
                当前跑的是哈希向量（确定性占位，不是语义嵌入），重建出来的仍然是哈希向量。
                要拿到真正的语义检索，先在设置里配好 Embedding 模型并重启后端，再回来重建。
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-body text-fg-secondary">
                <input
                  type="radio"
                  name="reindex-scope"
                  checked={reindexScope === 'role'}
                  onChange={() => {
                    setReindexScope('role');
                  }}
                />
                只重建当前 Agent
              </label>
              <label className="flex items-center gap-2 text-body text-fg-secondary">
                <input
                  type="radio"
                  name="reindex-scope"
                  checked={reindexScope === 'all'}
                  onChange={() => {
                    setReindexScope('all');
                  }}
                />
                全量（含市场池）
              </label>
              <label className="flex items-center gap-2 text-body text-fg-secondary">
                <input
                  type="checkbox"
                  checked={reindexForce}
                  onChange={(e) => {
                    setReindexForce(e.target.checked);
                  }}
                />
                强制重算
              </label>
            </div>
            <p className="text-body text-fg-muted">
              不勾「强制重算」时只补为空或维度对不上的记录，重跑很便宜。
              <strong className="text-fg-secondary">
                新旧模型维度相同时（比如都降到 1536）必须勾上
              </strong>
              ，否则维度看着是对的，一条都不会重算。
            </p>
            <Button
              size="sm"
              variant="secondary"
              disabled={reindexBusy}
              onClick={() => void runReindex()}
            >
              {reindexBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {reindexBusy ? '重建中…（不要关闭）' : '开始重建'}
            </Button>
            {reindexBusy && (
              <p className="text-body text-fg-muted">
                后端逐条重算并写回，没有进度事件；记录多时会持续几分钟。
              </p>
            )}
            {reindexResult && <ReindexResultCard result={reindexResult} />}
          </div>
        </Gate>
      </Panel>

      {/* ── 2 · 检索 ── */}
      <Panel>
        <SectionHeader icon={Search} title="记忆检索" method="memory.searchMemory" />
        <Gate capabilities={capabilities} op="search_memory" what="记忆检索">
          <div className="space-y-3">
            <p className="text-body text-fg-muted">
              在当前角色的技能与经验里做向量召回，每条结果附后端算出的余弦相似度。
            </p>
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
              }}
              placeholder="描述你要找的东西，例如：数据库连接池超时的处理办法"
              className={INPUT_CLASS}
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-body text-fg-secondary">
                  返回条数
                  <span className="ml-2 font-mono text-code text-fg-faint">top_k</span>
                </label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={topK}
                  onChange={(e) => {
                    setTopK(e.target.value);
                  }}
                  placeholder="留空用后端默认 5"
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label className="mb-1 block text-body text-fg-secondary">
                  相似度下限
                  <span className="ml-2 font-mono text-code text-fg-faint">min_similarity</span>
                </label>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={minSimilarity}
                  onChange={(e) => {
                    setMinSimilarity(e.target.value);
                  }}
                  placeholder="0 ~ 1，留空不限"
                  className={INPUT_CLASS}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-body text-fg-secondary">
                <input
                  type="checkbox"
                  checked={includeSkills}
                  onChange={(e) => {
                    setIncludeSkills(e.target.checked);
                  }}
                  className="h-4 w-4 rounded-chip accent-command"
                />
                包含技能
              </label>
              <label className="flex items-center gap-2 text-body text-fg-secondary">
                <input
                  type="checkbox"
                  checked={includeExperiences}
                  onChange={(e) => {
                    setIncludeExperiences(e.target.checked);
                  }}
                  className="h-4 w-4 rounded-chip accent-command"
                />
                包含经验
              </label>
              <Button
                size="sm"
                variant="primary"
                className="ml-auto"
                onClick={() => void runSearch()}
                disabled={
                  searching ||
                  query.trim() === '' ||
                  (!includeSkills && !includeExperiences) ||
                  !roleId
                }
              >
                <Search className="h-3.5 w-3.5" />
                {searching ? '检索中…' : '检索'}
              </Button>
            </div>

            {searching && !searchResult && <Pending text="正在向量召回…" />}
            {searchResult && (
              <div className="space-y-3">
                <div>
                  <div className="mb-2 text-body text-fg-secondary">
                    命中技能 · <span className="tabular">{searchResult.skills.length}</span>
                  </div>
                  {searchResult.skills.length === 0 ? (
                    <p className="text-body text-fg-muted">这次检索没有命中技能。</p>
                  ) : (
                    <div className="space-y-2">
                      {searchResult.skills.map((skill) => (
                        <Panel key={skill.id} density="compact" className="bg-surface-void">
                          <div className="flex items-start justify-between gap-2">
                            <span className="min-w-0 text-body text-fg-primary">
                              {skill.description}
                            </span>
                            <Badge variant="command">
                              <span className="tabular">{fixed3(skill.similarity)}</span>
                            </Badge>
                          </div>
                          <p className="mt-1 line-clamp-3 text-body text-fg-muted">
                            {skill.content}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <IdChip value={skill.id} label="技能" />
                            {skill.tags.map((tag) => (
                              <span
                                key={tag}
                                className="rounded-chip border border-edge px-1.5 font-mono text-code text-fg-muted"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        </Panel>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <div className="mb-2 text-body text-fg-secondary">
                    命中经验 · <span className="tabular">{searchResult.experiences.length}</span>
                  </div>
                  {searchResult.experiences.length === 0 ? (
                    <p className="text-body text-fg-muted">这次检索没有命中经验。</p>
                  ) : (
                    <div className="space-y-2">
                      {searchResult.experiences.map((experience) => (
                        <Panel key={experience.id} density="compact" className="bg-surface-void">
                          <div className="flex items-start justify-between gap-2">
                            <span className="min-w-0 text-body text-fg-primary">
                              {experience.description}
                            </span>
                            <Badge variant="command">
                              <span className="tabular">{fixed3(experience.similarity)}</span>
                            </Badge>
                          </div>
                          <p className="mt-1 line-clamp-3 text-body text-fg-muted">
                            {experience.content}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <IdChip value={experience.id} label="经验" />
                            <span className="text-body text-fg-muted">
                              置信度{' '}
                              <span className="tabular">{fixed3(experience.confidence)}</span>
                            </span>
                          </div>
                        </Panel>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </Gate>
      </Panel>

      {/* ── 3 · 经验 ── */}
      <Panel>
        <SectionHeader icon={Star} title="经验维护" method="memory.updateExperience" />
        <div className="space-y-4">
          <Gate capabilities={capabilities} op="list_experiences" what="经验列表">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  value={keywordDraft}
                  onChange={(e) => {
                    setKeywordDraft(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setKeyword(keywordDraft.trim());
                  }}
                  placeholder="按关键词过滤描述与正文（后端子串匹配，不走向量）"
                  className={INPUT_CLASS}
                />
                <Button
                  size="sm"
                  onClick={() => {
                    setKeyword(keywordDraft.trim());
                  }}
                  disabled={experiencesLoading}
                >
                  过滤
                </Button>
              </div>
              <UnavailableNote
                capabilities={capabilities}
                op="promote_experience"
                what="晋升经验"
              />
              <UnavailableNote capabilities={capabilities} op="update_experience" what="编辑经验" />
              <UnavailableNote capabilities={capabilities} op="delete_experience" what="删除经验" />
              {experiencesLoading && !experiences ? (
                <Pending text="正在读取经验…" />
              ) : !experiences ? (
                <p className="text-body text-fg-muted">经验列表尚未取回。</p>
              ) : experiences.length === 0 ? (
                <EmptyState
                  icon={Star}
                  title="没有匹配的经验"
                  hint={keyword ? '换个关键词，或清空过滤条件。' : '这个角色还没有沉淀经验。'}
                />
              ) : (
                <div className="max-h-72 space-y-2 overflow-y-auto">
                  {experiences.map((experience) => (
                    <Panel key={experience.id} density="compact" className="bg-surface-void">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 text-body text-fg-primary">
                          {experience.description}
                        </span>
                        <Badge variant={experience.type === 'negative' ? 'human' : 'default'}>
                          {EXPERIENCE_TYPE_LABEL[experience.type] ?? experience.type}
                        </Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-body text-fg-muted">
                        {experience.content}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <IdChip value={experience.id} label="经验" />
                        <span className="text-body text-fg-muted">
                          置信度 <span className="tabular">{fixed3(experience.confidence)}</span>
                        </span>
                        <span className="text-body text-fg-muted">
                          被引用 <span className="tabular">{experience.referenced_count}</span> 次
                        </span>
                        {experience.promoted_to && (
                          <span className="text-body text-fg-muted">
                            已晋升 <IdChip value={experience.promoted_to} label="技能" />
                          </span>
                        )}
                        <div className="ml-auto flex items-center gap-2">
                          {can(capabilities, 'promote_experience') &&
                            experience.type === 'positive' &&
                            !experience.promoted_to && (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={promotingId !== undefined}
                                onClick={() => void runPromote(experience)}
                              >
                                {promotingId === experience.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <TrendingUp className="h-3.5 w-3.5" />
                                )}
                                晋升
                              </Button>
                            )}
                          {can(capabilities, 'update_experience') && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setEditing(experience);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              编辑
                            </Button>
                          )}
                          {can(capabilities, 'delete_experience') && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setDeleting(experience);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              删除
                            </Button>
                          )}
                        </div>
                      </div>
                    </Panel>
                  ))}
                </div>
              )}
            </div>
          </Gate>

          <div className="border-t border-edge pt-4">
            <SectionHeader
              icon={Search}
              title="按来源任务溯源"
              method="memory.listExperiencesBySourceTask"
            />
            <Gate
              capabilities={capabilities}
              op="list_experiences_by_source_task"
              what="按来源任务溯源"
            >
              <div className="space-y-2">
                <p className="text-body text-fg-muted">
                  这条按 task_id 跨所有 Agent 查，不限于当前角色。
                </p>
                <div className="flex items-center gap-2">
                  <input
                    value={sourceTaskId}
                    onChange={(e) => {
                      setSourceTaskId(e.target.value);
                    }}
                    placeholder="任务 ID"
                    className={INPUT_CLASS}
                  />
                  <Button
                    size="sm"
                    onClick={() => void lookupBySourceTask()}
                    disabled={sourceLoading || sourceTaskId.trim() === ''}
                  >
                    {sourceLoading ? '查询中…' : '查询'}
                  </Button>
                </div>
                {sourceExperiences &&
                  (sourceExperiences.length === 0 ? (
                    <p className="text-body text-fg-muted">这个任务没有派生出任何经验。</p>
                  ) : (
                    <div className="space-y-2">
                      {sourceExperiences.map((experience) => (
                        <Panel key={experience.id} density="compact" className="bg-surface-void">
                          <div className="text-body text-fg-primary">{experience.description}</div>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <IdChip value={experience.id} label="经验" />
                            <IdChip value={experience.agent_id} label="归属" />
                            <span className="text-body text-fg-muted">
                              置信度{' '}
                              <span className="tabular">{fixed3(experience.confidence)}</span>
                            </span>
                            {experience.source_user_rating && (
                              <span className="text-body text-fg-muted">
                                已评分
                                <span className="ml-2 font-mono text-code text-fg-faint">
                                  {experience.source_user_rating}
                                </span>
                              </span>
                            )}
                          </div>
                        </Panel>
                      ))}
                    </div>
                  ))}
              </div>
            </Gate>
          </div>

          <div className="border-t border-edge pt-4">
            <SectionHeader icon={Star} title="任务评分" method="memory.rateTask" />
            <Gate capabilities={capabilities} op="rate_task" what="任务评分">
              <div className="space-y-2">
                <p className="text-body text-fg-muted">
                  评分会改写该任务派生经验的置信度，并回填仍处于待提取状态的缓冲区快照。
                </p>
                <input
                  value={rateTaskId}
                  onChange={(e) => {
                    setRateTaskId(e.target.value);
                  }}
                  placeholder="任务 ID"
                  className={INPUT_CLASS}
                />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {RATING_CHOICES.map((choice) => (
                    <button
                      key={choice.value}
                      type="button"
                      onClick={() => {
                        setRating(choice.value);
                      }}
                      className={`rounded-panel border px-3 py-2 text-left transition-colors ${
                        rating === choice.value
                          ? 'border-command/60 bg-surface-raised'
                          : 'border-edge bg-surface-void hover:border-edge-strong'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-body text-fg-primary">{choice.label}</span>
                        <span className="font-mono text-code text-fg-faint">{choice.value}</span>
                      </div>
                      <div className="text-body text-fg-muted">{choice.delta}</div>
                    </button>
                  ))}
                </div>
                <Textarea
                  value={ratingNote}
                  onChange={(e) => {
                    setRatingNote(e.target.value);
                  }}
                  rows={2}
                  placeholder="备注（可选）"
                />
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => void submitRating()}
                    disabled={ratingBusy || rateTaskId.trim() === '' || !roleId}
                  >
                    {ratingBusy ? '提交中…' : '提交评分'}
                  </Button>
                  {ratingResult && (
                    <span className="text-body text-fg-secondary">
                      已改写 <span className="tabular">{ratingResult.updated_experiences}</span>{' '}
                      条经验 ·{' '}
                      {ratingResult.buffer_updated
                        ? '缓冲区快照已回填'
                        : '没有匹配的待提取快照可回填'}
                    </span>
                  )}
                </div>
              </div>
            </Gate>
          </div>
        </div>
      </Panel>

      {/* ── 4 · 缓冲区与维护 ── */}
      <Panel>
        <SectionHeader
          icon={Inbox}
          title="缓冲区与维护"
          method="memory.getBufferState"
          right={
            bufferStateAvailable ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setRevision((n) => n + 1);
                }}
                disabled={bufferLoading}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                刷新
              </Button>
            ) : undefined
          }
        />
        <Gate capabilities={capabilities} op="get_buffer_state" what="缓冲区状态">
          {bufferLoading && !bufferState ? (
            <Pending text="正在读取缓冲区…" />
          ) : !bufferState ? (
            <p className="text-body text-fg-muted">缓冲区状态尚未取回。</p>
          ) : (
            <div className="space-y-4">
              <div className="rounded-panel border border-edge bg-surface-void px-3 py-2">
                <IdRow label="角色" value={bufferState.meta.role_id} />
                <KeyValue k="待提取" v={intText(bufferState.meta.pending_count)} mono />
                <KeyValue k="写入游标" v={intText(bufferState.meta.cursor)} mono />
                <KeyValue k="已处理" v={intText(bufferState.meta.total_processed)} mono />
                <KeyValue k="累计死信" v={intText(bufferState.meta.total_dead_letters)} mono />
                <KeyValue
                  k="已清理"
                  v={
                    bufferState.meta.total_cleaned === undefined
                      ? '后端未给出'
                      : String(bufferState.meta.total_cleaned)
                  }
                  mono
                />
                <KeyValue k="上次提取" v={bufferState.meta.last_extraction_at ?? '从未提取过'} />
                <KeyValue
                  k="上次报告"
                  v={
                    bufferState.meta.last_extraction_report_count === undefined
                      ? '后端未给出'
                      : String(bufferState.meta.last_extraction_report_count)
                  }
                  mono
                />
                <KeyValue
                  k="上次产出"
                  v={
                    bufferState.meta.last_extraction_experiences_created === undefined
                      ? '后端未给出'
                      : String(bufferState.meta.last_extraction_experiences_created)
                  }
                  mono
                />
              </div>

              {/* 死信先讲：它是这块面板存在的理由 */}
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <AlertTriangle
                    className={`h-4 w-4 ${
                      bufferState.dead_letters.length > 0 ? 'text-danger-soft' : 'text-fg-faint'
                    }`}
                    aria-hidden
                  />
                  <span className="text-body text-fg-secondary">
                    死信 · <span className="tabular">{bufferState.dead_letters.length}</span>
                  </span>
                  <span className="font-mono text-code text-fg-faint">memory.retryExtraction</span>
                </div>
                <UnavailableNote
                  capabilities={capabilities}
                  op="retry_extraction"
                  what="重试提取"
                />
                {bufferState.dead_letters.length === 0 ? (
                  <p className="text-body text-fg-muted">
                    当前没有死信。
                    {bufferState.dead_letter_seqs.length > 0 &&
                      ` 但后端另报了 ${String(bufferState.dead_letter_seqs.length)} 个死信序号，两份数据不一致。`}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {bufferState.dead_letters.map((entry) => (
                      <Panel
                        key={entry.seq}
                        density="compact"
                        className="border-danger/30 bg-surface-void"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="tabular rounded-chip border border-edge px-1.5 font-mono text-code text-fg-secondary">
                            #{entry.seq}
                          </span>
                          <IdChip value={entry.task_id} label="任务" />
                          <span className="text-body text-fg-muted">{entry.failed_at}</span>
                          {can(capabilities, 'retry_extraction') && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="ml-auto"
                              onClick={() => {
                                setRetryTarget(entry);
                              }}
                              disabled={retrying}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              重试
                            </Button>
                          )}
                        </div>
                        <p className="mt-1 text-body text-danger-soft">
                          {entry.reason ?? '后端没有记录失败原因。'}
                        </p>
                      </Panel>
                    ))}
                  </div>
                )}
                {retryEvidence && (
                  <Panel density="compact" className="mt-2 bg-surface-void">
                    <div className="flex items-center gap-2">
                      <span className="text-body text-fg-secondary">已重新入队</span>
                      <Badge variant={retryEvidence.status === 'failed' ? 'danger' : 'ok'}>
                        {MAINTENANCE_STATUS_LABEL[retryEvidence.status]}
                      </Badge>
                      <span className="font-mono text-code text-fg-faint">
                        {retryEvidence.kind} · {retryEvidence.status}
                      </span>
                    </div>
                    <div className="mt-1">
                      <IdRow label="维护证据" value={retryEvidence.maintenance_ref} />
                    </div>
                    {retryEvidence.warnings.map((warning) => (
                      <p key={warning} className="text-body text-human-soft">
                        {warning}
                      </p>
                    ))}
                    {retryEvidence.error && (
                      <p className="text-body text-danger-soft">{retryEvidence.error}</p>
                    )}
                    <p className="mt-1 text-body text-fg-muted">
                      这是调度证据，不是提取结果 —— 提取跑完要重新刷新才看得到。
                    </p>
                  </Panel>
                )}
              </div>

              {/* 待提取队列 */}
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-body text-fg-secondary">
                    待提取序号 · <span className="tabular">{bufferState.pending_seqs.length}</span>
                  </span>
                  <span className="font-mono text-code text-fg-faint">memory.getPendingBuffer</span>
                </div>
                <UnavailableNote
                  capabilities={capabilities}
                  op="get_pending_buffer"
                  what="查看待提取快照"
                />
                {bufferState.pending_seqs.length === 0 ? (
                  <p className="text-body text-fg-muted">队列是空的，没有等待提取的报告。</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {bufferState.pending_seqs.map((seq) => (
                      <button
                        key={seq}
                        type="button"
                        disabled={!pendingBufferAvailable}
                        onClick={() => {
                          setOpenSeq((current) => (current === seq ? undefined : seq));
                        }}
                        className={`tabular rounded-chip border px-2 py-1 font-mono text-code transition-colors disabled:opacity-40 ${
                          openSeq === seq
                            ? 'border-command/60 bg-surface-raised text-fg-primary'
                            : 'border-edge bg-surface-void text-fg-secondary hover:border-edge-strong'
                        }`}
                      >
                        #{seq}
                      </button>
                    ))}
                  </div>
                )}

                {openSeq !== undefined && (
                  <div className="mt-3">
                    {pendingLoading ? (
                      <Pending text={`正在读取 #${String(openSeq)} 的快照…`} />
                    ) : pendingBuffer === null ? (
                      <p className="text-body text-fg-muted">
                        后端没有返回这一条的快照。它已经不在待提取目录里：可能已提取完成、已进死信，
                        也可能这个序号根本不存在。
                      </p>
                    ) : pendingBuffer ? (
                      <PendingBufferDetail seq={openSeq} buffer={pendingBuffer} />
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          )}
        </Gate>
      </Panel>

      {editing && (
        <ExperienceEditDialog
          roleId={roleId}
          experience={editing}
          onClose={() => {
            setEditing(undefined);
          }}
          onSaved={() => {
            setEditing(undefined);
            bump();
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== undefined}
        title="删除这条经验？"
        description={
          deleting
            ? `「${deleting.description}」将被永久删除，来源任务 ${deleting.source_task_id}，当前置信度 ${fixed3(deleting.confidence)}。此操作不可撤销。`
            : ''
        }
        confirmLabel="删除"
        onConfirm={() => {
          if (deleting) void confirmDelete(deleting);
        }}
        onClose={() => {
          setDeleting(undefined);
        }}
      />

      <ConfirmDialog
        open={retryTarget !== undefined}
        danger={false}
        title="重新提取这条死信？"
        description={
          retryTarget
            ? `目标序号 #${String(retryTarget.seq)}，来源任务 ${retryTarget.task_id}，失败于 ${retryTarget.failed_at}，原因：${retryTarget.reason ?? '后端没有记录'}。确认后它会被恢复成待提取并重新入队维护链路。`
            : ''
        }
        confirmLabel="重试提取"
        onConfirm={() => {
          if (retryTarget) void confirmRetry(retryTarget.seq);
        }}
        onClose={() => {
          setRetryTarget(undefined);
        }}
      />
    </div>
  );
}

/** 一条待提取快照的全部事实。Driver 的 6 字段报告分块折叠，默认只露摘要。 */
/**
 * 重建索引的结果卡。
 *
 * `failures` 是逐条收集的：后端不因单条失败中断整体，所以「成功」和「有失败」会同时出现 ——
 * 只报重建条数而不摆失败，等于把一半的漏网记录藏起来。
 */
function ReindexResultCard({ result }: { result: RpcReindexResult }) {
  return (
    <Panel density="compact" className="bg-surface-void">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={result.failures.length === 0 ? 'ok' : 'human'}>
          {result.failures.length === 0 ? '重建完成' : '部分失败'}
        </Badge>
        <Badge>{result.scope === 'all' ? '全量' : '单 Agent'}</Badge>
        {result.role_id && <IdChip value={result.role_id} label="角色" />}
        <span className="text-body text-fg-muted">
          目标维度 <span className="tabular">{intText(result.dimensions)}</span>
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="扫描 Agent" value={intText(result.agents_processed)} />
        <Stat label="技能重建" value={intText(result.skills_reindexed)} />
        <Stat label="技能跳过" value={intText(result.skills_skipped)} />
        <Stat label="经验重建" value={intText(result.experiences_reindexed)} />
        <Stat label="经验跳过" value={intText(result.experiences_skipped)} />
        <Stat label="失败" value={intText(result.failures.length)} />
      </div>
      {result.skills_reindexed === 0 && result.experiences_reindexed === 0 && (
        <p className="mt-2 text-body text-fg-muted">
          一条都没重算。若刚换过同维度的模型，勾上「强制重算」再跑一次 ——
          不勾时后端只看维度对不对，看不出模型换没换。
        </p>
      )}
      {result.failures.length > 0 && (
        <div className="mt-2 space-y-1">
          {result.failures.map((failure) => (
            <div
              key={`${failure.kind}:${failure.id}`}
              className="flex flex-wrap items-center gap-2"
            >
              <Badge variant="danger">{failure.kind === 'skill' ? '技能' : '经验'}</Badge>
              <IdChip value={failure.id} />
              <IdChip value={failure.agent_id} label="归属" />
              <span className="min-w-0 text-body text-danger-soft">{failure.error}</span>
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-body text-fg-faint">
        {result.started_at} → {result.completed_at}
      </p>
    </Panel>
  );
}

function PendingBufferDetail({ seq, buffer }: { seq: number; buffer: RpcPendingBuffer }) {
  const { snapshot, agentContext } = buffer;
  const report = snapshot.driver_return;
  return (
    <div className="space-y-3 rounded-panel border border-edge bg-surface-void p-3">
      <div className="flex items-center gap-2">
        <span className="tabular rounded-chip border border-edge px-1.5 font-mono text-code text-fg-secondary">
          #{seq}
        </span>
        <Badge variant={snapshot.extraction_status === 'dead_letter' ? 'danger' : 'default'}>
          {EXTRACTION_STATUS_LABEL[snapshot.extraction_status] ?? snapshot.extraction_status}
        </Badge>
        <span className="font-mono text-code text-fg-faint">{snapshot.extraction_status}</span>
      </div>

      <p className="text-body text-fg-primary">{snapshot.task_description}</p>

      <div>
        <IdRow label="任务" value={snapshot.task_id} />
        <IdRow label="来源任务" value={snapshot.source_task_id} />
        <KeyValue k="驱动" v={snapshot.source_driver} mono />
        <KeyValue k="接收时间" v={snapshot.received_at} />
        <KeyValue k="重试次数" v={String(snapshot.retry_count)} mono />
        <KeyValue k="用户评分" v={snapshot.user_rating ?? '尚未评分'} />
        <KeyValue k="上下文" v={snapshot.context_snapshot_ref ?? '未配对，提取只用执行报告'} />
      </div>

      <div className="rounded-panel border border-edge">
        <Fold id={`buffer-${String(seq)}-summary`} title="执行摘要" defaultOpen>
          <p className="whitespace-pre-wrap text-body text-fg-secondary">
            {report.summary || '后端没有给出摘要。'}
          </p>
          <p className="mt-1 text-body text-fg-muted">
            自评效果：
            {report.effectiveness
              ? (EFFECTIVENESS_LABEL[report.effectiveness] ?? report.effectiveness)
              : '未给出'}
          </p>
        </Fold>
        <Fold
          id={`buffer-${String(seq)}-artifacts`}
          title="产出制品"
          meta={String(report.artifacts.length)}
        >
          {report.artifacts.length === 0 ? (
            <p className="text-body text-fg-muted">这次执行没有登记产出。</p>
          ) : (
            report.artifacts.map((artifact) => (
              <div key={`${artifact.type}:${artifact.path}`} className="py-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-code text-fg-secondary">{artifact.path}</span>
                  <span className="font-mono text-code text-fg-faint">{artifact.type}</span>
                </div>
                <p className="text-body text-fg-muted">{artifact.summary}</p>
              </div>
            ))
          )}
        </Fold>
        <Fold
          id={`buffer-${String(seq)}-decisions`}
          title="决策路径"
          meta={String(report.decisions.length)}
        >
          {report.decisions.length === 0 ? (
            <p className="text-body text-fg-muted">没有登记决策点。</p>
          ) : (
            report.decisions.map((decision) => (
              <div key={decision.point} className="py-1">
                <div className="text-body text-fg-primary">{decision.point}</div>
                <div className="text-body text-fg-secondary">选择：{decision.chosen}</div>
                <div className="text-body text-fg-muted">理由：{decision.reason}</div>
                {decision.options.length > 0 && (
                  <div className="text-body text-fg-muted">
                    备选：{decision.options.join(' / ')}
                  </div>
                )}
              </div>
            ))
          )}
        </Fold>
        <Fold
          id={`buffer-${String(seq)}-blockers`}
          title="阻塞项"
          meta={String(report.blockers.length)}
          status={report.blockers.some((item) => !item.resolved) ? 'human' : 'idle'}
        >
          {report.blockers.length === 0 ? (
            <p className="text-body text-fg-muted">没有登记阻塞项。</p>
          ) : (
            report.blockers.map((blocker) => (
              <div key={blocker.blocker} className="py-1">
                <div className="flex items-center gap-2">
                  <span className="text-body text-fg-primary">{blocker.blocker}</span>
                  <Badge variant={blocker.resolved ? 'ok' : 'human'}>
                    {blocker.resolved ? '已解决' : '未解决'}
                  </Badge>
                </div>
                <div className="text-body text-fg-muted">处置：{blocker.resolution}</div>
                {blocker.attempts.length > 0 && (
                  <div className="text-body text-fg-muted">
                    尝试过：{blocker.attempts.join(' / ')}
                  </div>
                )}
              </div>
            ))
          )}
        </Fold>
        <Fold
          id={`buffer-${String(seq)}-referenced`}
          title="引用的经验"
          meta={String(report.referenced_experiences.length)}
        >
          {report.referenced_experiences.length === 0 ? (
            <p className="text-body text-fg-muted">这次执行没有引用历史经验。</p>
          ) : (
            report.referenced_experiences.map((item) => (
              <div key={item.experience_id} className="py-1">
                <div className="flex flex-wrap items-center gap-2">
                  <IdChip value={item.experience_id} label="经验" />
                  <Badge variant={item.applied ? 'default' : 'human'}>
                    {item.applied ? '已采用' : '未采用'}
                  </Badge>
                  <span className="text-body text-fg-secondary">
                    {EFFECTIVENESS_LABEL[item.effectiveness] ?? item.effectiveness}
                  </span>
                </div>
                {item.note && <p className="text-body text-fg-muted">{item.note}</p>}
              </div>
            ))
          )}
        </Fold>
        <Fold
          id={`buffer-${String(seq)}-assumptions`}
          title="执行假设"
          meta={String(report.assumptions.length)}
        >
          {report.assumptions.length === 0 ? (
            <p className="text-body text-fg-muted">没有登记假设。</p>
          ) : (
            report.assumptions.map((item) => (
              <div key={item.assumption} className="py-1">
                <div className="text-body text-fg-primary">{item.assumption}</div>
                <div className="text-body text-fg-muted">出错后果：{item.risk_if_wrong}</div>
              </div>
            ))
          )}
        </Fold>
        <Fold id={`buffer-${String(seq)}-context`} title="上下文快照">
          {!agentContext ? (
            <p className="text-body text-fg-muted">
              这条报告没有配对的上下文快照，提取只会用到上面的执行报告。
            </p>
          ) : (
            <div>
              <IdRow label="快照" value={agentContext.snapshot_id} />
              <IdRow label="Agent" value={agentContext.agent_id} />
              <KeyValue k="清理于" v={agentContext.cleaned_at} />
              <KeyValue
                k="Token"
                v={`${String(agentContext.original_token_count)} → ${String(agentContext.cleaned_token_count)}`}
                mono
              />
              <KeyValue k="压缩比" v={fixed3(agentContext.compression_ratio)} mono />
              <KeyValue k="调用数" v={String(agentContext.driver_calls.length)} mono />
              {agentContext.thinking_trace && (
                <div className="mt-2">
                  <div className="text-body text-fg-muted">思考轨迹</div>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-panel border border-edge bg-surface-void p-2 font-mono text-code text-fg-secondary">
                    {agentContext.thinking_trace}
                  </pre>
                </div>
              )}
              {agentContext.planning_trace && (
                <div className="mt-2">
                  <div className="text-body text-fg-muted">计划轨迹</div>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-panel border border-edge bg-surface-void p-2 font-mono text-code text-fg-secondary">
                    {agentContext.planning_trace}
                  </pre>
                </div>
              )}
            </div>
          )}
        </Fold>
      </div>
    </div>
  );
}

/**
 * 经验编辑弹窗。只送真正改过的字段：后端的 `ExperienceWritePatch` 要求至少一个字段，
 * 且 description / content 有 `min(1)`，所以清空一段文字不是「删掉它」而是 -32602。
 */
function ExperienceEditDialog({
  roleId,
  experience,
  onClose,
  onSaved,
}: {
  roleId: string;
  experience: RpcExperienceView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [description, setDescription] = useState(experience.description);
  const [content, setContent] = useState(experience.content);
  const [tags, setTags] = useState(experience.tags.join(', '));
  const [confidence, setConfidence] = useState(String(experience.confidence));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const nextTags = splitTags(tags);
  const nextConfidence = parseUnitFloat(confidence);
  const tagsChanged =
    nextTags.length !== experience.tags.length ||
    nextTags.some((tag, index) => tag !== experience.tags[index]);
  const patch: MemoryExperienceWritePatch = {
    ...(description.trim() && description.trim() !== experience.description
      ? { description: description.trim() }
      : {}),
    ...(content.trim() && content.trim() !== experience.content ? { content: content.trim() } : {}),
    ...(tagsChanged ? { tags: nextTags } : {}),
    ...(nextConfidence !== undefined && nextConfidence !== experience.confidence
      ? { confidence: nextConfidence }
      : {}),
  };
  const dirty = Object.keys(patch).length > 0;
  // description / content 后端都带 min(1)：清空不是「删掉这段」，而是一次 -32602。
  // 所以这里不提交空值，但必须说出来，否则用户会以为自己清空成功了。
  const clearedRequired = description.trim() === '' || content.trim() === '';

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await memoryApi.updateExperience(roleId, experience.id, patch);
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} className="max-w-xl">
      <div className="max-h-[85vh] overflow-y-auto p-6">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-panel bg-command/15 text-command-soft">
            <Pencil className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-title text-fg-primary">编辑经验</h2>
            <p className="truncate text-body text-fg-muted">
              改动只会送出真正变了的字段。
              <span className="ml-2 font-mono text-code text-fg-faint">
                memory.updateExperience
              </span>
            </p>
          </div>
        </div>

        <div className="mt-4">
          <IdRow label="经验" value={experience.id} />
          <IdRow label="来源任务" value={experience.source_task_id} />
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-body text-fg-secondary">描述</label>
          <input
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
            }}
            className={INPUT_CLASS}
          />
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-body text-fg-secondary">正文</label>
          <Textarea
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
            }}
            rows={6}
          />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-body text-fg-secondary">标签（逗号分隔）</label>
            <input
              value={tags}
              onChange={(e) => {
                setTags(e.target.value);
              }}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className="mb-1 block text-body text-fg-secondary">置信度（0 ~ 1）</label>
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={confidence}
              onChange={(e) => {
                setConfidence(e.target.value);
              }}
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <p className="mt-2 text-body text-fg-muted">
          改置信度会向该经验的历史追加一条来源为手工调整的记录，并重算该 Agent 的平均置信度。
        </p>

        {clearedRequired && (
          <p className="mt-2 text-body text-human-soft">
            描述与正文都不能清空，后端会直接拒绝。留空的那一段不会被提交，原值保持不变。
          </p>
        )}

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-panel border border-danger/30 bg-surface-void p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger-soft" aria-hidden />
            <span className="text-body text-fg-secondary">{error}</span>
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          {!dirty && <span className="mr-auto text-body text-fg-muted">还没有任何改动。</span>}
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
