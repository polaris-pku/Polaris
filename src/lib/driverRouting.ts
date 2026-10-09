import { createStore } from 'zustand/vanilla';
import { driverApi } from '@/api/driver';
import { BackendError } from '@/api/transport';
import type {
  DriverRoutingSnapshot,
  ResetDriverRoutingInput,
  UpdateDriverRoutingInput,
} from '@/api/types/driverRouting';

export type RoutingDraft = Pick<UpdateDriverRoutingInput, 'default_driver' | 'roles'>;
export type RoutingIssue = {
  kind: 'conflict' | 'busy' | 'locked' | 'field' | 'write' | 'unsupported' | 'other';
  message: string;
  field?: string;
  lockedDriverId?: string;
};
type PendingWrite =
  | { kind: 'save'; input: UpdateDriverRoutingInput }
  | { kind: 'reset'; input: ResetDriverRoutingInput };

export function routingDraft(snapshot: DriverRoutingSnapshot): RoutingDraft {
  return {
    default_driver: snapshot.default_driver,
    roles: Object.fromEntries(snapshot.roles.map((role) => [role.role_id, role.driver_id])),
  };
}

export function routingUpdate(
  snapshot: DriverRoutingSnapshot,
  draft: RoutingDraft,
): UpdateDriverRoutingInput {
  return {
    expected_revision: snapshot.revision,
    default_driver: draft.default_driver,
    roles: { ...routingDraft(snapshot).roles, ...draft.roles },
  };
}

/** Keep only intentional edits; retain concurrent changes and newly discovered orphan mappings. */
export function rebaseRoutingDraft(
  original: DriverRoutingSnapshot,
  draft: RoutingDraft,
  latest: DriverRoutingSnapshot,
): RoutingDraft {
  const result = routingDraft(latest);
  const previous = routingDraft(original);
  if (draft.default_driver !== previous.default_driver)
    result.default_driver = draft.default_driver;
  result.roles = {
    ...result.roles,
    ...Object.fromEntries(
      Object.entries(draft.roles).filter(([role, driver]) => driver !== previous.roles[role]),
    ),
  };
  return result;
}

export function routingIssue(error: unknown): RoutingIssue {
  const data =
    error instanceof BackendError && error.data && typeof error.data === 'object'
      ? (error.data as Record<string, unknown>)
      : {};
  const string = (key: string) => (typeof data[key] === 'string' ? data[key] : undefined);
  const field = string('field');
  const details = Array.isArray(data.limitations)
    ? data.limitations.filter((value): value is string => typeof value === 'string').join('；')
    : '';
  const code = error instanceof BackendError ? error.code : undefined;
  switch (code) {
    case -32021:
      return {
        kind: 'conflict',
        message: '配置已被其他实例修改。你的编辑已保留，请读取最新配置后选择如何合并。',
      };
    case -32026:
      return { kind: 'busy', message: '配置正在被其他实例写入，尚未保存。稍后可重试同一请求。' };
    case -32025:
      return {
        kind: 'locked',
        message: `默认驱动已被部署设置锁定为 ${string('locked_driver_id') ?? '指定驱动'}；仍可修改角色分配。`,
        field,
        lockedDriverId: string('locked_driver_id'),
      };
    case -32022:
      return {
        kind: 'field',
        message: `驱动 ${string('driver_id') ?? ''} 不存在，请重新读取配置。`,
        field,
      };
    case -32023:
      return {
        kind: 'field',
        message: `驱动 ${string('driver_id') ?? ''} 不可选择。${details || string('reason_code') || '请检查后端驱动档案。'}`,
        field,
      };
    case -32024:
      return {
        kind: 'write',
        message: `无法读写项目驱动配置：${string('error_summary') ?? '请检查项目 .agent 目录权限。'}`,
      };
    case -32601:
      return { kind: 'unsupported', message: '当前后端不支持驱动路由，请更新后端后重新读取。' };
    case -32602:
      return { kind: 'other', message: '驱动路由参数不符合后端契约，请重新读取配置。' };
    default:
      return { kind: 'other', message: error instanceof Error ? error.message : String(error) };
  }
}

interface RoutingEditorState {
  snapshot: DriverRoutingSnapshot | null;
  draft: RoutingDraft | null;
  conflict: DriverRoutingSnapshot | null;
  issue: RoutingIssue | null;
  pending: PendingWrite | null;
  lockedDriverId?: string;
  busy: boolean;
  notice: string | null;
  load(): Promise<void>;
  changeDefault(driver: string): void;
  changeRole(role: string, driver: string): void;
  save(): Promise<void>;
  reset(): Promise<void>;
  retry(): Promise<void>;
  resolveConflict(keepEdits: boolean): void;
  cancel(): void;
}

export function createDriverRoutingEditor(api = driverApi) {
  let epoch = 0;
  const install = (snapshot: DriverRoutingSnapshot, notice: string | null = null) =>
    store.setState({
      snapshot,
      draft: routingDraft(snapshot),
      conflict: null,
      issue: null,
      pending: null,
      notice,
    });
  const execute = async (write: PendingWrite) => {
    if (store.getState().busy) return;
    const ticket = ++epoch;
    store.setState({ busy: true, issue: null, notice: null, pending: null });
    try {
      const snapshot =
        write.kind === 'save'
          ? await api.updateRouting(write.input)
          : await api.resetRouting(write.input);
      if (ticket === epoch)
        install(
          snapshot,
          write.kind === 'save'
            ? '路由已保存；仅影响新创建的运行。'
            : '已恢复文件配置；运行中的任务不变。',
        );
    } catch (error) {
      if (ticket !== epoch) return;
      const issue = routingIssue(error);
      store.setState({ issue, pending: issue.kind === 'busy' ? write : null });
      if (issue.kind === 'locked' && issue.lockedDriverId) {
        const draft = store.getState().draft;
        store.setState({
          lockedDriverId: issue.lockedDriverId,
          ...(draft ? { draft: { ...draft, default_driver: issue.lockedDriverId } } : {}),
        });
      }
      if (issue.kind === 'conflict') {
        try {
          const latest = await api.getConfig();
          if (ticket === epoch) store.setState({ conflict: latest });
        } catch (readError) {
          if (ticket === epoch)
            store.setState({
              issue: {
                ...issue,
                message: `${issue.message} 最新配置读取失败：${routingIssue(readError).message}`,
              },
            });
        }
      }
    } finally {
      if (ticket === epoch) store.setState({ busy: false });
    }
  };
  const store = createStore<RoutingEditorState>()((set, get) => ({
    snapshot: null,
    draft: null,
    conflict: null,
    issue: null,
    pending: null,
    busy: false,
    notice: null,
    async load() {
      if (get().busy) return;
      const ticket = ++epoch;
      set({ busy: true, issue: null, notice: null, pending: null });
      try {
        const latest = await api.getConfig();
        if (ticket !== epoch) return;
        if (get().snapshot && get().draft && latest.revision !== get().snapshot?.revision) {
          set({
            conflict: latest,
            issue: {
              kind: 'conflict',
              message: '配置版本已变化。你的编辑已保留，请选择如何合并。',
            },
          });
        } else if (get().snapshot && get().draft) {
          const { snapshot, draft } = get();
          if (snapshot && draft)
            set({
              snapshot: latest,
              draft: rebaseRoutingDraft(snapshot, draft, latest),
              conflict: null,
              issue: null,
              pending: null,
            });
        } else install(latest);
      } catch (error) {
        if (ticket === epoch) set({ issue: routingIssue(error) });
      } finally {
        if (ticket === epoch) set({ busy: false });
      }
    },
    changeDefault(driver) {
      const draft = get().draft;
      if (get().busy || get().lockedDriverId || !draft) return;
      set({ draft: { ...draft, default_driver: driver }, pending: null, notice: null });
    },
    changeRole(role, driver) {
      const draft = get().draft;
      if (get().busy || !draft) return;
      set({
        draft: { ...draft, roles: { ...draft.roles, [role]: driver } },
        pending: null,
        notice: null,
      });
    },
    async save() {
      const { snapshot, draft, conflict, issue } = get();
      if (snapshot && draft && !conflict && issue?.kind !== 'conflict') {
        await execute({ kind: 'save', input: routingUpdate(snapshot, draft) });
      }
    },
    async reset() {
      const { snapshot, conflict, issue } = get();
      if (snapshot && !conflict && issue?.kind !== 'conflict') {
        await execute({ kind: 'reset', input: { expected_revision: snapshot.revision } });
      }
    },
    async retry() {
      const pending = get().pending;
      if (pending) await execute(pending);
    },
    resolveConflict(keepEdits) {
      const { snapshot, draft, conflict } = get();
      if (!snapshot || !draft || !conflict || get().busy) return;
      const nextDraft = keepEdits
        ? rebaseRoutingDraft(snapshot, draft, conflict)
        : routingDraft(conflict);
      set({
        snapshot: conflict,
        draft: nextDraft,
        conflict: null,
        issue: null,
        pending: null,
        notice: keepEdits ? '已保留你的修改，请检查后再次保存。' : '已采用最新配置。',
      });
    },
    cancel() {
      epoch += 1;
      set({ busy: false });
    },
  }));
  return store;
}
