import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Loader2, Pencil, Plus, Search, Store, Tags, Trash2, Upload } from 'lucide-react';
import { memoryApi } from '@/api/memory';
import {
  INPUT_CLASS,
  MARKET_LABEL,
  MARKET_POOL_ROLE_ID,
  MARKET_TONE,
  parseTags,
  REVIEW_LABEL,
  REVIEW_TONE,
} from '@/components/memory/memoryShared';
import { CapabilityNotice, TagRow, WireBadge } from '@/components/memory/shared';
import type {
  MemoryCapabilities,
  MemoryMarketStatusPatch,
  MemorySkillWritePatch,
  RpcSkillRecord,
  RpcSkillView,
} from '@/api/types/memory';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { IdChip } from '@/components/ui/IdChip';
import { Panel } from '@/components/ui/Panel';
import { Textarea } from '@/components/ui/Textarea';
import { ConfirmDialog } from '@/components/ConfirmDialog';

/**
 * 技能写入口 · 技能市场 —— 单个 Agent 名下的技能读写，加上从市场池引入。
 *
 * 跨 Agent 的**待审队列**已经搬去 `OrgConsolePanel`：`listPendingReviews()` 不吃 role_id，
 * 审批也走技能自己的 `agent_id`，本来就跟这里选中的是谁无关。
 *
 * 三条贯穿本文件的约束，都来自后端代码而不是审美：
 *
 * 1. **入口按能力声明渲染。** 每个动作先问 `capabilities.operations`，声明为 unavailable
 *    就不给按钮，并把后端给的 reason 原样说出来 —— 摆一个点下去必然报错的按钮，比没有更糟。
 * 2. **审核是单向状态机。** 后端 `reviewSkill` 只接受 pending → approved / rejected，
 *    approved / rejected 之后再审直接抛错。所以「驳回」和「删除」一样要走确认。
 * 3. **上架不等于进市场 —— 上游 #114 之后更是如此。** `marketSearch` 现在
 *    `WHERE role_id = '__market__'`（pg-memory-repository.ts），只搜市场池；而
 *    `publishSkillToMarket` 在 memory-writer.ts 里就一行 `updateSkill({market_status:'available'})`,
 *    技能仍挂在原 Agent 名下，**根本没进池子**。技能进入市场池的唯一途径是 Agent 退休时的
 *    `disposeRetiredAssets`。所以按钮文案只说「已标记为上架」，绝不能说「别人现在能搜到了」。
 *    审核通过 + 未废弃仍是必要条件，但已经不是充分条件。
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

const MARKET_STATUS_CHOICES: { value: MemoryMarketStatusPatch; label: string }[] = [
  { value: 'available', label: '已上架' },
  { value: 'superseded', label: '已废弃' },
];

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
  const [reloadToken, setReloadToken] = useState(0);
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [editing, setEditing] = useState<{ skill: RpcSkillView | null }>();
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>();
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
      // 后端这个方法只把 market_status 置为 available（memory-writer.ts 里就一行 updateSkill），
      // **不会**把技能迁进市场池 __market__，而 marketSearch 只搜市场池 —— 所以不能说
      // 「其他 Agent 现在能搜到它」，那是句假话。
      return result.skill.review_status === 'approved'
        ? '已标记为上架。注意：市场检索只搜市场池，技能要等这个 Agent 退休时随资产处置迁入才会被别人搜到。'
        : '已标记为上架，但它还没通过审核。';
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
          上架只是把状态写成已上架（也用来撤销已废弃），它
          <strong className="text-fg-secondary">不会</strong>
          让技能出现在别人的市场检索里 —— 市场检索只搜市场池，而技能进入市场池的唯一途径是这个 Agent
          退休时的资产处置。被引用过的技能迁入并保持在架，没被引用过的标记为独占保留。
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

      {/* ── 二、技能市场 ── */}
      <section className="space-y-3">
        <div>
          <h3 className="flex items-center gap-2 text-title text-fg-primary">
            <Store className="h-4 w-4 text-fg-muted" />
            技能市场
          </h3>
          <p className="text-body text-fg-muted">
            按语义检索<strong className="text-fg-secondary">市场池</strong>
            里已过审的技能，引入后会在本 Agent 名下生成一份副本。市场池只装退休 Agent
            交出来的技能，在职 Agent 的技能搜不到。
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
