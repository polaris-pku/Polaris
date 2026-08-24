import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  ClipboardList,
  Download,
  Loader2,
  Pencil,
  Plus,
  Search,
  Store,
  Tags,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { memoryApi } from '@/api/memory';
import type {
  MemoryCapabilities,
  MemoryMarketStatusPatch,
  MemoryOperationName,
  MemorySkillWritePatch,
  RpcSkillRecord,
  RpcSkillView,
} from '@/api/types/memory';
import { Badge, type BadgeProps } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { IdChip } from '@/components/ui/IdChip';
import { Panel } from '@/components/ui/Panel';
import { Textarea } from '@/components/ui/Textarea';
import { ConfirmDialog } from '@/components/ConfirmDialog';

/**
 * 技能写入口 · 审核队列 · 技能市场 —— 覆盖 9 个 `memory.*` 写／读方法。
 *
 * 三条贯穿本文件的约束，都来自后端代码而不是审美：
 *
 * 1. **入口按能力声明渲染。** 每个动作先问 `capabilities.operations`，声明为 unavailable
 *    就不给按钮，并把后端给的 reason 原样说出来 —— 摆一个点下去必然报错的按钮，比没有更糟。
 * 2. **审核是单向状态机。** 后端 `reviewSkill` 只接受 pending → approved / rejected，
 *    approved / rejected 之后再审直接抛错。所以「驳回」和「删除」一样要走确认。
 * 3. **上架不等于进市场。** 市场准入是「审核已通过 且 未被标记为已废弃」
 *    （`isMarketEligibleSkill`）—— 上架只是把状态显式写成已上架，也用来撤销已废弃。
 *    未过审的技能上架后依然搜不到，这一点必须当场讲清楚，不能让用户以为按钮没生效。
 *
 * 还有一处「后端没给就别编」：`memory.marketSearch` 内部按余弦相似度排序并按下限过滤，
 * 但返回体里**不带每条的相似度分值**（仓库层 `.map(({ skill }) => skill)` 把它丢了）。
 * 所以这里只标排序位次，绝不换算出一个假的百分比。
 */
export interface MemoryPanelProps {
  roleId: string;
  capabilities: MemoryCapabilities | undefined;
  onError: (message: string) => void;
  /** 任何写操作成功后调用，让父页重新拉取 Agent / 技能 / 维护证据。 */
  onChanged: () => void;
}

const INPUT_CLASS =
  'w-full rounded-panel border border-edge-strong bg-surface-void px-3 py-2 text-body text-fg-primary placeholder:text-fg-faint focus:border-command focus:outline-none focus:ring-1 focus:ring-command/40';

/** 线上 `review_status` 声明为宽 string，这里只做翻译，认不出来的原样透出（见 WireBadge）。 */
const REVIEW_LABEL: Record<string, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
};

const REVIEW_TONE: Record<string, BadgeProps['variant']> = {
  pending: 'human',
  approved: 'ok',
  rejected: 'danger',
};

/** `retired_unique` 只由退休流程写入，手工 PATCH 写不进，但读得到。 */
const MARKET_LABEL: Record<string, string> = {
  available: '已上架',
  superseded: '已废弃',
  retired_unique: '退休独有',
};

const MARKET_TONE: Record<string, BadgeProps['variant']> = {
  available: 'ok',
  superseded: 'default',
  retired_unique: 'human',
};

/** 编辑态允许写入的两个 market_status（RPC 层 zod 收窄，不含 retired_unique）。 */
const MARKET_STATUS_CHOICES: { value: MemoryMarketStatusPatch; label: string }[] = [
  { value: 'available', label: '已上架' },
  { value: 'superseded', label: '已废弃' },
];

/** 退休资产池的固定 role_id：技能在这里表示原主人已退休。 */
const MARKET_POOL_ROLE_ID = '__market__';

const OPERATION_LABEL: Partial<Record<MemoryOperationName, string>> = {
  list_skills: '技能列表',
  create_skill: '新建技能',
  update_skill: '编辑技能',
  delete_skill: '删除技能',
  publish_skill: '上架市场',
  list_pending_reviews: '待审队列',
  approve_skill: '通过审核',
  reject_skill: '驳回技能',
  market_search: '市场检索',
  market_import: '引入技能',
};

type SkillSubmitPayload =
  | {
      kind: 'create';
      input: { description: string; content: string; tags?: string[]; version?: string };
    }
  | { kind: 'update'; skillId: string; patch: MemorySkillWritePatch };

type PendingConfirm = {
  title: string;
  description: string;
  confirmLabel: string;
  run: () => void;
};

const message = (reason: unknown): string =>
  reason instanceof Error ? reason.message : String(reason);

const parseTags = (raw: string): string[] =>
  raw
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);

/** 词表命中就只显示中文；没命中才把协议原值作为灰色注解挂在中文标签旁（F2）。 */
function WireBadge({
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

/** 后端声明为 unavailable 的操作：不给按钮，改说一句「为什么没有」。 */
function CapabilityNotice({
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

function TagRow({ tags }: { tags: string[] }) {
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

function PendingLine({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 text-body text-fg-muted">
      <Loader2 className="h-4 w-4 animate-spin" />
      {text}
    </p>
  );
}

export function SkillMarketPanel({ roleId, capabilities, onError, onChanged }: MemoryPanelProps) {
  // 父页很可能用内联箭头函数传这两个回调；放进 ref 才不会把它们卷进 effect 依赖里反复重拉。
  const onErrorRef = useRef(onError);
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onErrorRef.current = onError;
    onChangedRef.current = onChanged;
  });

  const [skills, setSkills] = useState<RpcSkillView[]>();
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [reviews, setReviews] = useState<RpcSkillView[]>();
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [editing, setEditing] = useState<{ skill: RpcSkillView | null }>();
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>();
  const [reviewer, setReviewer] = useState('');
  const [marketQuery, setMarketQuery] = useState('');
  const [marketTopK, setMarketTopK] = useState('');
  const [marketMinSimilarity, setMarketMinSimilarity] = useState('');
  const [excludeSelf, setExcludeSelf] = useState(true);
  const [marketHits, setMarketHits] = useState<RpcSkillRecord[]>();
  const [marketSearching, setMarketSearching] = useState(false);
  const [importedSourceIds, setImportedSourceIds] = useState<string[]>([]);

  const operations = capabilities?.operations;
  const canListSkills = operations?.list_skills?.status === 'available';
  const canCreateSkill = operations?.create_skill?.status === 'available';
  const canUpdateSkill = operations?.update_skill?.status === 'available';
  const canDeleteSkill = operations?.delete_skill?.status === 'available';
  const canPublishSkill = operations?.publish_skill?.status === 'available';
  const canListReviews = operations?.list_pending_reviews?.status === 'available';
  const canApproveSkill = operations?.approve_skill?.status === 'available';
  const canRejectSkill = operations?.reject_skill?.status === 'available';
  const canMarketSearch = operations?.market_search?.status === 'available';
  const canMarketImport = operations?.market_import?.status === 'available';

  useEffect(() => {
    if (!roleId || !canListSkills) {
      setSkills(undefined);
      return;
    }
    let active = true;
    setSkillsLoading(true);
    void memoryApi
      .listSkills(roleId)
      .then((result) => {
        if (active) setSkills(result.skills);
      })
      .catch((reason: unknown) => {
        if (active) onErrorRef.current(message(reason));
      })
      .finally(() => {
        if (active) setSkillsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [roleId, canListSkills, reloadToken]);

  // 待审队列是**跨 Agent** 的：它不随选中的 Agent 变化，只随审核动作刷新。
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
        if (active) onErrorRef.current(message(reason));
      })
      .finally(() => {
        if (active) setReviewsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canListReviews, reloadToken]);

  const runMutation = useCallback((key: string, action: () => Promise<string>) => {
    setBusy(key);
    setNotice(undefined);
    void action()
      .then((result) => {
        setNotice(result);
        setReloadToken((token) => token + 1);
        onChangedRef.current();
      })
      .catch((reason: unknown) => {
        onErrorRef.current(message(reason));
      })
      .finally(() => {
        setBusy(undefined);
      });
  }, []);

  const reviewedBy = reviewer.trim();

  const submitSkillForm = (payload: SkillSubmitPayload) => {
    if (payload.kind === 'create') {
      runMutation('skill-form', async () => {
        const result = await memoryApi.createSkill({ role_id: roleId, ...payload.input });
        setEditing(undefined);
        const known = (skills ?? []).some((item) => item.id === result.skill.id);
        if (known) {
          return '描述与内容完全相同的技能已经存在，后端把原记录还回来了，没有重复创建。';
        }
        const status = REVIEW_LABEL[result.skill.review_status] ?? result.skill.review_status;
        return `已新建技能，当前状态：${status}。`;
      });
      return;
    }
    runMutation('skill-form', async () => {
      await memoryApi.updateSkill(roleId, payload.skillId, payload.patch);
      setEditing(undefined);
      return '已更新技能。';
    });
  };

  const publishSkill = (skill: RpcSkillView) => {
    runMutation(`publish:${skill.id}`, async () => {
      const result = await memoryApi.publishSkillToMarket(roleId, skill.id);
      return result.skill.review_status === 'approved'
        ? '已上架，其他 Agent 现在可以在市场里搜到它。'
        : '已标记为上架，但它还没通过审核，暂时不会出现在市场检索结果里。';
    });
  };

  const requestDeleteSkill = (skill: RpcSkillView) => {
    setPendingConfirm({
      title: '删除这条技能？',
      description: `「${skill.description}」会被永久删除，后端没有回收站也没有撤销。已经从市场引入过它的其他 Agent 保留各自的副本，不受影响。`,
      confirmLabel: '永久删除',
      run: () => {
        runMutation(`delete:${skill.id}`, async () => {
          await memoryApi.deleteSkill(roleId, skill.id);
          return '已删除技能。';
        });
      },
    });
  };

  const approveSkill = (skill: RpcSkillView) => {
    runMutation(`approve:${skill.id}`, async () => {
      await memoryApi.approveSkill(skill.agent_id, skill.id, reviewedBy || undefined);
      return '已通过审核，这条技能从下一次任务开始进入检索。';
    });
  };

  const requestRejectSkill = (skill: RpcSkillView) => {
    setPendingConfirm({
      title: '驳回这条技能？',
      description:
        '审核是单向的：驳回之后不能再改回待审核。驳回还会解除它与来源经验的晋升绑定，那条经验之后可以被重新晋升。',
      confirmLabel: '驳回',
      run: () => {
        runMutation(`reject:${skill.id}`, async () => {
          await memoryApi.rejectSkill(skill.agent_id, skill.id, reviewedBy || undefined);
          return '已驳回这条技能。';
        });
      },
    });
  };

  const searchMarket = () => {
    const query = marketQuery.trim();
    if (!query || marketSearching) return;

    let topK: number | undefined;
    const rawTopK = marketTopK.trim();
    if (rawTopK) {
      topK = Number(rawTopK);
      if (!Number.isInteger(topK) || topK <= 0) {
        onError('返回条数要填正整数；留空则由后端用默认的 10 条。');
        return;
      }
    }

    let minSimilarity: number | undefined;
    const rawMin = marketMinSimilarity.trim();
    if (rawMin) {
      minSimilarity = Number(rawMin);
      if (!Number.isFinite(minSimilarity) || minSimilarity < 0 || minSimilarity > 1) {
        onError('相似度下限要落在 0 到 1 之间；留空则由后端决定。');
        return;
      }
    }

    setMarketSearching(true);
    setNotice(undefined);
    void memoryApi
      .marketSearch({
        query,
        ...(topK !== undefined ? { top_k: topK } : {}),
        ...(minSimilarity !== undefined ? { min_similarity: minSimilarity } : {}),
        ...(excludeSelf && roleId ? { exclude_agent_id: roleId } : {}),
      })
      .then((result) => {
        setMarketHits(result.skills);
      })
      .catch((reason: unknown) => {
        onErrorRef.current(message(reason));
      })
      .finally(() => {
        setMarketSearching(false);
      });
  };

  const importSkill = (hit: RpcSkillRecord) => {
    runMutation(`import:${hit.id}`, async () => {
      const result = await memoryApi.marketImport(roleId, hit.id);
      setImportedSourceIds((current) =>
        current.includes(hit.id) ? current : [...current, hit.id],
      );
      return result.import.created
        ? '已引入，副本归本 Agent 所有，来源技能保持不变。'
        : '这条技能之前已经引入过，后端没有重复建副本。';
    });
  };

  if (!roleId) {
    return (
      <EmptyState
        icon={Tags}
        title="先选择一个 Agent"
        hint="技能写入与市场引入都要落到某个 Agent 名下。"
      />
    );
  }

  return (
    <div className="space-y-6">
      {notice && (
        <Panel density="compact" className="border-ok/30">
          <p className="text-body text-fg-secondary">{notice}</p>
        </Panel>
      )}

      {/* ── 一、本 Agent 技能 ── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-title text-fg-primary">本 Agent 技能</h3>
            <p className="text-body text-fg-muted">
              {skills ? (
                <>
                  共 <span className="tabular">{skills.length}</span> 条
                </>
              ) : (
                '尚未读取'
              )}
            </p>
          </div>
          {canCreateSkill && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setEditing({ skill: null });
              }}
              disabled={busy !== undefined}
            >
              <Plus className="h-3.5 w-3.5" />
              新建技能
            </Button>
          )}
        </div>

        <CapabilityNotice
          capabilities={capabilities}
          names={['list_skills', 'create_skill', 'update_skill', 'delete_skill', 'publish_skill']}
        />

        <p className="text-body text-fg-muted">
          进入市场检索的条件是「审核已通过」且「未被标记为已废弃」。上架只是把状态显式写成已上架，也用来撤销已废弃
          —— 真正让技能出现在别人市场里的是审核通过。
        </p>

        {skillsLoading && !skills && <PendingLine text="正在读取技能…" />}

        {skills && skills.length === 0 && (
          <EmptyState
            icon={Tags}
            title="这个 Agent 还没有技能"
            hint="可以手动新建一条，也可以从下面的技能市场引入。"
          />
        )}

        {skills && skills.length > 0 && (
          <div className="space-y-2">
            {skills.map((skill) => (
              <Panel key={skill.id} density="compact" className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="text-body text-fg-primary">{skill.description}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <WireBadge
                        dict={REVIEW_LABEL}
                        tone={REVIEW_TONE}
                        value={skill.review_status}
                        fallbackLabel="审核状态"
                      />
                      {skill.market_status ? (
                        <WireBadge
                          dict={MARKET_LABEL}
                          tone={MARKET_TONE}
                          value={skill.market_status}
                          fallbackLabel="市场状态"
                        />
                      ) : (
                        <span className="text-body text-fg-muted">未标记市场状态</span>
                      )}
                      <span className="text-body text-fg-muted">
                        版本 <span className="tabular font-mono text-code">{skill.version}</span>
                      </span>
                      <IdChip value={skill.id} label="技能" />
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    {canUpdateSkill && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditing({ skill });
                        }}
                        disabled={busy !== undefined}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        编辑
                      </Button>
                    )}
                    {canPublishSkill && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          publishSkill(skill);
                        }}
                        disabled={busy !== undefined || skill.market_status === 'available'}
                      >
                        <Upload className="h-3.5 w-3.5" />
                        {skill.market_status === 'available' ? '已上架' : '上架市场'}
                      </Button>
                    )}
                    {canDeleteSkill && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-danger-soft hover:text-danger"
                        onClick={() => {
                          requestDeleteSkill(skill);
                        }}
                        disabled={busy !== undefined}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        删除
                      </Button>
                    )}
                  </div>
                </div>
                {skill.content && (
                  <p className="line-clamp-3 text-body text-fg-muted">{skill.content}</p>
                )}
                <TagRow tags={skill.tags} />
              </Panel>
            ))}
          </div>
        )}
      </section>

      {/* ── 二、待审技能（跨 Agent） ── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-2 text-title text-fg-primary">
              <ClipboardList className="h-4 w-4 text-fg-muted" />
              待审技能
            </h3>
            <p className="text-body text-fg-muted">
              这是全部 Agent
              的待审队列，不只是当前选中的这个。审核单向：通过或驳回之后改不回待审核。
            </p>
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-body text-fg-secondary" htmlFor="skill-reviewer">
              审核人（可选 · 留空后端记为 user）
            </label>
            <input
              id="skill-reviewer"
              value={reviewer}
              onChange={(event) => {
                setReviewer(event.target.value);
              }}
              placeholder="例如：fangz"
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <CapabilityNotice
          capabilities={capabilities}
          names={['list_pending_reviews', 'approve_skill', 'reject_skill']}
        />

        {reviewsLoading && !reviews && <PendingLine text="正在读取待审队列…" />}

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
              <Panel key={skill.id} density="compact" className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="text-body text-fg-primary">{skill.description}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {skill.agent_id === roleId && <Badge variant="command">本 Agent</Badge>}
                      <IdChip value={skill.agent_id} label="所属" />
                      <IdChip value={skill.id} label="技能" />
                      <span className="text-body text-fg-muted">
                        版本 <span className="tabular font-mono text-code">{skill.version}</span>
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {canApproveSkill && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          approveSkill(skill);
                        }}
                        disabled={busy !== undefined}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        通过
                      </Button>
                    )}
                    {canRejectSkill && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-danger-soft hover:text-danger"
                        onClick={() => {
                          requestRejectSkill(skill);
                        }}
                        disabled={busy !== undefined}
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
      </section>

      {/* ── 三、技能市场 ── */}
      <section className="space-y-3">
        <div>
          <h3 className="flex items-center gap-2 text-title text-fg-primary">
            <Store className="h-4 w-4 text-fg-muted" />
            技能市场
          </h3>
          <p className="text-body text-fg-muted">
            按语义检索其他 Agent 已过审的技能，引入后会在本 Agent 名下生成一份副本。
          </p>
        </div>

        <CapabilityNotice capabilities={capabilities} names={['market_search', 'market_import']} />

        {canMarketSearch && (
          <Panel density="compact" className="space-y-3">
            <div>
              <label className="mb-1 block text-body text-fg-secondary" htmlFor="market-query">
                检索文本
              </label>
              <input
                id="market-query"
                value={marketQuery}
                onChange={(event) => {
                  setMarketQuery(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') searchMarket();
                }}
                placeholder="例如：给 REST 接口补权限校验"
                className={INPUT_CLASS}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-body text-fg-secondary" htmlFor="market-top-k">
                  返回条数（可选 · 留空用后端默认 10）
                </label>
                <input
                  id="market-top-k"
                  value={marketTopK}
                  onChange={(event) => {
                    setMarketTopK(event.target.value);
                  }}
                  inputMode="numeric"
                  placeholder="10"
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label className="mb-1 block text-body text-fg-secondary" htmlFor="market-min-sim">
                  相似度下限（可选 · 0 到 1）
                </label>
                <input
                  id="market-min-sim"
                  value={marketMinSimilarity}
                  onChange={(event) => {
                    setMarketMinSimilarity(event.target.value);
                  }}
                  inputMode="decimal"
                  placeholder="0.3"
                  className={INPUT_CLASS}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-body text-fg-secondary">
                <input
                  type="checkbox"
                  checked={excludeSelf}
                  onChange={(event) => {
                    setExcludeSelf(event.target.checked);
                  }}
                  className="h-4 w-4 rounded-chip border border-edge-strong bg-surface-void"
                />
                排除本 Agent 自己的技能
              </label>
              <Button
                size="sm"
                variant="primary"
                onClick={searchMarket}
                disabled={marketQuery.trim().length === 0 || marketSearching}
              >
                {marketSearching ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Search className="h-3.5 w-3.5" />
                )}
                搜索市场
              </Button>
            </div>
          </Panel>
        )}

        {marketSearching && !marketHits && <PendingLine text="正在检索技能市场…" />}

        {marketHits && marketHits.length === 0 && (
          <EmptyState
            icon={Search}
            title="没有命中的市场技能"
            hint="换一个说法，或者把相似度下限调低、返回条数调大。"
          />
        )}

        {marketHits && marketHits.length > 0 && (
          <>
            <p className="text-body text-fg-muted">
              结果已由后端按相似度从高到低排序，但返回体里不带每条的分值，所以这里只标排序位次，不折算百分比。
            </p>
            <div className="space-y-2">
              {marketHits.map((hit, index) => {
                const imported = importedSourceIds.includes(hit.id);
                return (
                  <Panel key={hit.id} density="compact" className="space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-baseline gap-2">
                          <span className="tabular font-mono text-code text-fg-faint">
                            #{index + 1}
                          </span>
                          <p className="min-w-0 text-body text-fg-primary">{hit.description}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {hit.agent_id === MARKET_POOL_ROLE_ID ? (
                            <Badge variant="human">退休资产池</Badge>
                          ) : (
                            <IdChip value={hit.agent_id} label="来自" />
                          )}
                          {hit.origin_agent_id && hit.origin_agent_id !== hit.agent_id && (
                            <IdChip value={hit.origin_agent_id} label="原创" />
                          )}
                          <span className="text-body text-fg-muted">
                            版本 <span className="tabular font-mono text-code">{hit.version}</span>
                          </span>
                          <span className="text-body text-fg-muted">
                            已被 <span className="tabular">{hit.imported_by?.length ?? 0}</span> 个
                            Agent 引入
                          </span>
                        </div>
                      </div>
                      {canMarketImport && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            importSkill(hit);
                          }}
                          disabled={busy !== undefined || imported}
                        >
                          <Download className="h-3.5 w-3.5" />
                          {imported ? '已引入' : '引入'}
                        </Button>
                      )}
                    </div>
                    {hit.content && (
                      <p className="line-clamp-3 text-body text-fg-muted">{hit.content}</p>
                    )}
                    <TagRow tags={hit.tags} />
                  </Panel>
                );
              })}
            </div>
          </>
        )}
      </section>

      {editing && (
        <SkillFormDialog
          key={editing.skill ? editing.skill.id : 'create'}
          skill={editing.skill}
          submitting={busy === 'skill-form'}
          onClose={() => {
            setEditing(undefined);
          }}
          onSubmit={submitSkillForm}
        />
      )}

      <ConfirmDialog
        open={pendingConfirm !== undefined}
        title={pendingConfirm?.title ?? ''}
        description={pendingConfirm?.description ?? ''}
        confirmLabel={pendingConfirm?.confirmLabel ?? '确认'}
        onConfirm={() => {
          pendingConfirm?.run();
        }}
        onClose={() => {
          setPendingConfirm(undefined);
        }}
      />
    </div>
  );
}

/**
 * 新建 / 编辑技能。
 *
 * 编辑态只提交**真的改过**的字段：后端 `updateSkillParamsSchema` 有 refine，
 * 一个字段都不给就是 -32602，白挨一个报错。description / content 是 `min(1)`，
 * 所以空串在这里就拦下，不让它变成一次注定失败的往返。
 */
function SkillFormDialog({
  skill,
  submitting,
  onClose,
  onSubmit,
}: {
  skill: RpcSkillView | null;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: SkillSubmitPayload) => void;
}) {
  const [description, setDescription] = useState(skill?.description ?? '');
  const [content, setContent] = useState(skill?.content ?? '');
  const [tags, setTags] = useState((skill?.tags ?? []).join(', '));
  const [version, setVersion] = useState('');
  const [marketStatus, setMarketStatus] = useState<'' | MemoryMarketStatusPatch>('');

  const nextDescription = description.trim();
  const nextContent = content.trim();
  const nextTags = parseTags(tags);
  const filled = nextDescription.length > 0 && nextContent.length > 0;

  let patch: MemorySkillWritePatch = {};
  if (skill) {
    const tagsChanged =
      nextTags.length !== skill.tags.length || nextTags.some((tag, i) => tag !== skill.tags[i]);
    patch = {
      ...(nextDescription !== skill.description ? { description: nextDescription } : {}),
      ...(nextContent !== skill.content ? { content: nextContent } : {}),
      ...(tagsChanged ? { tags: nextTags } : {}),
      ...(marketStatus && marketStatus !== skill.market_status
        ? { market_status: marketStatus }
        : {}),
    };
  }
  const dirty = Object.keys(patch).length > 0;
  const canSubmit = filled && !submitting && (skill ? dirty : true);

  const submit = () => {
    if (!canSubmit) return;
    if (skill) {
      onSubmit({ kind: 'update', skillId: skill.id, patch });
      return;
    }
    onSubmit({
      kind: 'create',
      input: {
        description: nextDescription,
        content: nextContent,
        ...(nextTags.length > 0 ? { tags: nextTags } : {}),
        ...(version.trim() ? { version: version.trim() } : {}),
      },
    });
  };

  return (
    <Dialog open onClose={onClose} className="max-w-xl">
      <div className="p-6">
        <h2 className="text-title text-fg-primary">{skill ? '编辑技能' : '新建技能'}</h2>
        <p className="mt-1 text-body text-fg-muted">
          {skill
            ? '只有改动过的字段会被提交；一个都没改时提交按钮保持禁用。'
            : '同一个 Agent 下，描述与内容完全相同的技能不会被重复创建，后端会把原记录还回来。'}
        </p>

        <div className="mt-4">
          <label className="mb-1 block text-body text-fg-secondary" htmlFor="skill-description">
            技能描述（用于列表展示与相似度检索）
          </label>
          <input
            id="skill-description"
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
            placeholder="例如：为 Express 路由补 RBAC 中间件"
            className={INPUT_CLASS}
          />
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-body text-fg-secondary" htmlFor="skill-content">
            技能正文
          </label>
          <Textarea
            id="skill-content"
            value={content}
            onChange={(event) => {
              setContent(event.target.value);
            }}
            rows={6}
            placeholder="写清这条技能怎么用：步骤、代码片段、注意事项…"
          />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-body text-fg-secondary" htmlFor="skill-tags">
              标签（逗号分隔 · 可选）
            </label>
            <input
              id="skill-tags"
              value={tags}
              onChange={(event) => {
                setTags(event.target.value);
              }}
              placeholder="auth, express, security"
              className={INPUT_CLASS}
            />
          </div>
          {skill ? (
            <div>
              <label className="mb-1 block text-body text-fg-secondary" htmlFor="skill-market">
                市场状态（可选 · 不选就不改）
              </label>
              <select
                id="skill-market"
                value={marketStatus}
                onChange={(event) => {
                  setMarketStatus(event.target.value as '' | MemoryMarketStatusPatch);
                }}
                className={INPUT_CLASS}
              >
                <option value="">不修改</option>
                {MARKET_STATUS_CHOICES.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-body text-fg-secondary" htmlFor="skill-version">
                版本（可选 · 留空由后端写 1.0.0）
              </label>
              <input
                id="skill-version"
                value={version}
                onChange={(event) => {
                  setVersion(event.target.value);
                }}
                placeholder="1.0.0"
                className={INPUT_CLASS}
              />
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {skill ? '保存修改' : '创建技能'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
