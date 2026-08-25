/**
 * 全局控制台 —— Agent 控制台里不属于任何一个 Agent 的那一半。
 *
 * ## 为什么单独有这块
 *
 * `AgentBoard` 的主轴是「选中哪个 Agent」，四个标签页全锁在 `selectedRoleId` 后面。
 * 但 `memory.*` 里有五个调用**根本不吃 role_id**：
 *
 * | 调用 | 作用域 |
 * | --- | --- |
 * | `getOverview()` | 全局统计，无参 |
 * | `listPendingReviews()` | 跨 Agent 待审队列，无参 |
 * | `retirementScan()` | 不传 role_id 就是全量扫描 |
 * | `reindex()` | 不传 role_id 就是全量（含市场池） |
 * | `createAgent()` | 建的是**另一个** Agent，与当前选中的无关 |
 *
 * 把它们塞在某个 Agent 的标签页里，等于「要先随便选个 Agent 才能看全局总览 / 才能建新
 * Agent」。这块面板就是把这条轴拆出来。
 *
 * ## 这里**不**放什么
 *
 * 技能市场（`marketSearch` / `marketImport`）留在 `SkillMarketPanel`。检索结果虽然是全局的，
 * 但引入必须落到某个 Agent 名下（`marketImport(roleId, sourceSkillId)`）—— 搬过来就得再加
 * 一个「引入到哪个 Agent」的选择器，给主流程平白添一步。它按用途属于单 Agent 那一侧。
 *
 * 能力门控与其它面板同规矩：后端说 unavailable 就摆出它给的 reason，不画按下去必然报错的按钮。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  ClipboardList,
  Database,
  Loader2,
  RefreshCw,
  ScanSearch,
  UserPlus,
  XCircle,
} from 'lucide-react';
import { memoryApi } from '@/api/memory';
import type {
  MemoryAgentStatus,
  MemoryCapabilities,
  RpcMemoryOverview,
  RpcReindexResult,
  RpcRetirementScanResult,
  RpcSkillView,
} from '@/api/types/memory';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CreateAgentDialog } from '@/components/memory/CreateAgentDialog';
import {
  CapabilityNotice,
  Gate,
  Pending,
  ScanCard,
  SectionHeader,
  Stat,
  TagRow,
} from '@/components/memory/shared';
import { can, errorText, fixed3, INPUT_CLASS, intText } from '@/components/memory/memoryShared';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IdChip } from '@/components/ui/IdChip';
import { Panel } from '@/components/ui/Panel';

const AGENT_STATUS_LABEL: Record<MemoryAgentStatus, string> = {
  created: '已创建',
  active: '活跃',
  idle: '空闲',
  draining: '收尾中',
  retired: '已退休',
};

export interface OrgConsolePanelProps {
  capabilities: MemoryCapabilities | undefined;
  onError: (message: string) => void;
  /** 任何写操作成功后调用，让父页重新拉取名册。 */
  onChanged: () => void;
}

export function OrgConsolePanel({ capabilities, onError, onChanged }: OrgConsolePanelProps) {
  const fail = useCallback(
    (reason: unknown) => {
      onError(errorText(reason));
    },
    [onError],
  );

  /** 写操作成功后 +1，驱动本面板内所有只读区重取。 */
  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => {
    setRevision((n) => n + 1);
    onChanged();
  }, [onChanged]);

  // ── 总览 ──
  const overviewAvailable = can(capabilities, 'get_overview');
  const [overview, setOverview] = useState<RpcMemoryOverview>();
  const [overviewLoading, setOverviewLoading] = useState(false);

  // ── 待审队列 ──
  const canListReviews = can(capabilities, 'list_pending_reviews');
  const [reviews, setReviews] = useState<RpcSkillView[]>();
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewer, setReviewer] = useState('');
  const [reviewBusy, setReviewBusy] = useState<string>();
  const [rejecting, setRejecting] = useState<RpcSkillView>();

  // ── 退休扫描 ──
  const [scans, setScans] = useState<RpcRetirementScanResult[]>();
  const [scanning, setScanning] = useState(false);

  // ── 重建索引 ──
  const [reindexForce, setReindexForce] = useState(false);
  const [reindexBusy, setReindexBusy] = useState(false);
  const [reindexResult, setReindexResult] = useState<RpcReindexResult>();

  // ── 新建 Agent ──
  const [createOpen, setCreateOpen] = useState(false);

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
    if (!canListReviews) {
      setReviews(undefined);
      return;
    }
    let active = true;
    setReviewsLoading(true);
    void memoryApi
      .listPendingReviews()
      .then((result) => {
        if (active) setReviews(result.skills);
      })
      .catch((reason: unknown) => {
        if (active) fail(reason);
      })
      .finally(() => {
        if (active) setReviewsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canListReviews, revision, fail]);

  const reviewedBy = reviewer.trim();

  /** 审批走技能自己的 `agent_id`，不是某个「当前 Agent」—— 队列本来就是跨 Agent 的。 */
  const reviewSkill = async (skill: RpcSkillView, verdict: 'approve' | 'reject') => {
    if (reviewBusy) return;
    setReviewBusy(`${verdict}:${skill.id}`);
    try {
      if (verdict === 'approve') {
        await memoryApi.approveSkill(skill.agent_id, skill.id, reviewedBy || undefined);
      } else {
        await memoryApi.rejectSkill(skill.agent_id, skill.id, reviewedBy || undefined);
      }
      bump();
    } catch (reason) {
      fail(reason);
    } finally {
      setReviewBusy(undefined);
    }
  };

  /** 不传 role_id = 全量扫描。后端对单个 Agent 扫描失败会写一条 error 占位，不中断整体。 */
  const runScanAll = async () => {
    if (scanning) return;
    setScanning(true);
    setScans(undefined);
    try {
      const result = await memoryApi.retirementScan();
      setScans(result.scans);
    } catch (reason) {
      fail(reason);
    } finally {
      setScanning(false);
    }
  };

  /**
   * 全量重建。**同步且可能很慢** —— 后端顺序遍历每条记录逐个 embed，没有进度事件，
   * 耗时随记录数线性增长。所以按钮期间整段禁用，也不做超时兜底（超时只会让人以为失败了）。
   */
  const runReindex = async () => {
    if (reindexBusy) return;
    setReindexBusy(true);
    setReindexResult(undefined);
    try {
      const result = await memoryApi.reindex(reindexForce ? { force: true } : {});
      setReindexResult(result.reindex);
      bump();
    } catch (reason) {
      fail(reason);
    } finally {
      setReindexBusy(false);
    }
  };

  const hashEmbedding = capabilities?.embedding.provider === 'HashEmbeddingProvider';

  return (
    <div className="space-y-4">
      {/* ── 1 · 记忆总览 ── */}
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
                disabled={overviewLoading}
                onClick={() => {
                  setRevision((n) => n + 1);
                }}
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
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Agent 总数" value={intText(overview.agents.total)} />
                <Stat label="技能总数" value={intText(overview.skills.total)} />
                <Stat label="待审核技能" value={intText(overview.skills.pending_review)} />
                <Stat label="市场在架" value={intText(overview.skills.in_market)} />
                <Stat label="经验总数" value={intText(overview.experiences.total)} />
                <Stat label="缓冲区待提取" value={intText(overview.buffer.pending)} />
                <Stat label="缓冲区死信" value={intText(overview.buffer.dead_letters)} />
                <Stat label="平均置信度" value={fixed3(overview.quality.avg_confidence)} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body text-fg-muted">状态分布</span>
                {Object.entries(overview.agents.by_status).map(([status, count]) => (
                  <Badge key={status}>
                    {AGENT_STATUS_LABEL[status as MemoryAgentStatus] ?? status}
                    <span className="tabular ml-1.5 font-mono text-code text-fg-faint">
                      {intText(count)}
                    </span>
                  </Badge>
                ))}
                {Object.keys(overview.agents.by_status).length === 0 && (
                  <span className="text-body text-fg-muted">后端未给出任何状态计数。</span>
                )}
              </div>
            </div>
          ) : (
            <p className="text-body text-fg-muted">总览尚未取回。</p>
          )}
        </Gate>
      </Panel>

      {/* ── 2 · 待审技能（跨 Agent） ── */}
      <Panel>
        <SectionHeader
          icon={ClipboardList}
          title="待审技能"
          method="memory.listPendingReviews"
          right={
            <div className="min-w-0">
              <input
                aria-label="审核人"
                value={reviewer}
                onChange={(event) => {
                  setReviewer(event.target.value);
                }}
                placeholder="审核人（留空记为 user）"
                className={INPUT_CLASS}
              />
            </div>
          }
        />
        <p className="mb-3 text-body text-fg-muted">
          全部 Agent 的待审队列。审核是单向的：通过或驳回之后改不回待审核。
        </p>
        <CapabilityNotice
          capabilities={capabilities}
          names={['list_pending_reviews', 'approve_skill', 'reject_skill']}
        />
        {reviewsLoading && !reviews && <Pending text="正在读取待审队列…" />}
        {reviews && reviews.length === 0 && (
          <EmptyState
            icon={CheckCircle2}
            title="没有待审技能"
            hint="晋升出来的技能会自动排进这条队列。"
          />
        )}
        {reviews && reviews.length > 0 && (
          <div className="space-y-2">
            {reviews.map((skill) => (
              <Panel key={skill.id} density="compact" className="space-y-2 bg-surface-void">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="text-body text-fg-primary">{skill.description}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <IdChip value={skill.agent_id} label="所属" />
                      <IdChip value={skill.id} label="技能" />
                      <span className="text-body text-fg-muted">
                        版本 <span className="tabular font-mono text-code">{skill.version}</span>
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {can(capabilities, 'approve_skill') && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={reviewBusy !== undefined}
                        onClick={() => void reviewSkill(skill, 'approve')}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        通过
                      </Button>
                    )}
                    {can(capabilities, 'reject_skill') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-danger-soft hover:text-danger"
                        disabled={reviewBusy !== undefined}
                        onClick={() => {
                          setRejecting(skill);
                        }}
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        驳回
                      </Button>
                    )}
                  </div>
                </div>
                {skill.content && (
                  <p className="line-clamp-3 text-body text-fg-muted">{skill.content}</p>
                )}
                <TagRow tags={skill.tags} />
                {skill.promoted_from && (
                  <p className="text-body text-fg-muted">
                    这条技能由一条经验晋升而来，驳回会解除那条绑定。
                  </p>
                )}
              </Panel>
            ))}
          </div>
        )}
      </Panel>

      {/* ── 3 · 全量退休扫描 ── */}
      <Panel>
        <SectionHeader icon={ScanSearch} title="全量退休扫描" method="memory.retirementScan" />
        <Gate capabilities={capabilities} op="retirement_scan" what="退休扫描">
          <div className="space-y-3">
            <p className="text-body text-fg-muted">
              对全部 Agent 跑一遍三重门控（统计 / 画像漂移 / 模型）。
              <strong className="text-fg-secondary">只出结论，不会退休任何 Agent</strong>
              —— 真要退休得到对应 Agent 的「生命周期」里手动执行。单个 Agent 评估失败不会中断
              整体，那一条会带着错误说明出现在结果里。
            </p>
            <Button
              size="sm"
              variant="secondary"
              disabled={scanning}
              onClick={() => void runScanAll()}
            >
              {scanning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ScanSearch className="h-3.5 w-3.5" />
              )}
              {scanning ? '扫描中…' : '扫描全部 Agent'}
            </Button>
            {scanning && <Pending text="后端正在逐个 Agent 逐层评估…" />}
            {scans && scans.length === 0 && !scanning && (
              <p className="text-body text-fg-muted">后端这次没有返回任何评估结果。</p>
            )}
            {scans && scans.length > 0 && (
              <div className="space-y-2">
                {scans.map((scan) => (
                  <ScanCard key={scan.scan_id} scan={scan} showRole />
                ))}
              </div>
            )}
          </div>
        </Gate>
      </Panel>

      {/* ── 4 · 重建向量索引 ── */}
      <Panel>
        <SectionHeader icon={RefreshCw} title="重建向量索引" method="memory.reindex" />
        <Gate capabilities={capabilities} op="reindex" what="重建向量索引">
          <div className="space-y-3">
            <p className="text-body text-fg-muted">
              换了 embedding 模型之后，库里存量的向量还是旧模型算的，拿它跟新模型的 query
              比相似度没有意义。后端不会自动重建，这里是唯一入口。范围是全量，含市场池。
            </p>
            {capabilities && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body text-fg-muted">当前 provider</span>
                <Badge variant={hashEmbedding ? 'human' : 'ok'}>
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
            {hashEmbedding && (
              <p className="text-body text-human-soft">
                当前跑的是哈希向量（确定性占位，不是语义嵌入），重建出来的仍然是哈希向量。
                要拿到真正的语义检索，先在设置里配好 Embedding 模型并重启后端，再回来重建。
              </p>
            )}
            <label className="flex items-center gap-2 text-body text-fg-secondary">
              <input
                type="checkbox"
                checked={reindexForce}
                onChange={(event) => {
                  setReindexForce(event.target.checked);
                }}
              />
              强制重算
            </label>
            <p className="text-body text-fg-muted">
              不勾时只补为空或维度对不上的记录，重跑很便宜。
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

      {/* ── 5 · 新建 Agent ── */}
      <Panel>
        <SectionHeader icon={UserPlus} title="新建 Agent" method="memory.createAgent" />
        <Gate capabilities={capabilities} op="create_agent" what="新建 Agent">
          <div className="space-y-3">
            <p className="text-body text-fg-muted">
              手动建一个
              Agent，而不是等系统在派发时自动衍生。角色标识是后端主键，占用后不能再建同名的。
            </p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setCreateOpen(true);
              }}
            >
              <UserPlus className="h-3.5 w-3.5" />
              新建 Agent
            </Button>
          </div>
        </Gate>
      </Panel>

      <CreateAgentDialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
        }}
        onCreated={bump}
      />

      <ConfirmDialog
        open={rejecting !== undefined}
        title="驳回这条技能？"
        description="审核是单向的：驳回之后不能再改回待审核。驳回还会解除它与来源经验的晋升绑定，那条经验之后可以被重新晋升。"
        confirmLabel="驳回"
        onConfirm={() => {
          if (rejecting) void reviewSkill(rejecting, 'reject');
        }}
        onClose={() => {
          setRejecting(undefined);
        }}
      />
    </div>
  );
}

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
