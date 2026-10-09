import { useEffect, useId, useState } from 'react';
import { useStore } from 'zustand';
import { GitBranch, Loader2, LockKeyhole, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { createDriverRoutingEditor } from '@/lib/driverRouting';
import type { DriverRoutingDriver } from '@/api/types/driverRouting';

function driverLabel(driver: DriverRoutingDriver): string {
  const name = driver.display_name ?? driver.driver_id;
  const availability = !driver.selectable
    ? '不可选择'
    : driver.status === 'degraded'
      ? 'CLI 就绪未验证'
      : '已配置';
  return `${name}（${driver.agent} · ${availability}）`;
}

export function DriverRoutingPanel({
  available,
  workspace,
}: {
  available: boolean;
  workspace?: string;
}) {
  const [editor] = useState(createDriverRoutingEditor);
  const state = useStore(editor);
  const [confirmReset, setConfirmReset] = useState(false);
  const id = useId();

  useEffect(() => {
    if (available) void editor.getState().load();
    return () => editor.getState().cancel();
  }, [available, editor]);

  const snapshot = state.snapshot;
  const draft = state.draft;
  const conflict = state.issue?.kind === 'conflict';
  const disabled = !available || state.busy || conflict;
  const options = (value: string) => (
    <>
      {snapshot && !snapshot.drivers.some((driver) => driver.driver_id === value) && (
        <option value={value} disabled>
          {value}（配置中未找到）
        </option>
      )}
      {snapshot?.drivers.map((driver) => (
        <option key={driver.driver_id} value={driver.driver_id} disabled={!driver.selectable}>
          {driverLabel(driver)}
        </option>
      ))}
    </>
  );
  const selectClass =
    'w-full rounded-panel border border-edge-strong bg-surface-void px-2 py-2 font-mono text-code text-fg-primary outline-none focus-visible:border-command-soft disabled:opacity-50';

  return (
    <section
      className="mt-4 rounded-panel border border-edge bg-surface-panel p-4"
      aria-labelledby={`${id}-title`}
    >
      <div className="flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-command-soft" aria-hidden />
        <h3 id={`${id}-title`} className="text-title text-fg-primary">
          驱动路由
        </h3>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto"
          disabled={!available || state.busy}
          onClick={() => void state.load()}
          aria-label="重新读取驱动配置"
          title="重新读取驱动配置"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
        </Button>
      </div>
      <p className="mt-2 text-body text-fg-secondary">
        按角色选择执行驱动。保存不重启后端，只影响新创建的运行。
      </p>
      <p className="mt-1 break-all font-mono text-code text-fg-muted">
        当前后端工作区：{workspace || '后端项目'}
      </p>

      {!available ? (
        <p className="mt-3 text-body text-fg-muted">等待后端就绪后读取项目驱动配置。</p>
      ) : !snapshot && state.busy ? (
        <p className="mt-3 flex items-center gap-2 text-body text-fg-muted" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> 正在读取驱动配置
        </p>
      ) : snapshot && draft ? (
        <>
          <label htmlFor={`${id}-default`} className="mt-3 block text-body text-fg-primary">
            默认驱动
          </label>
          <select
            id={`${id}-default`}
            className={`mt-1 ${selectClass}`}
            value={draft.default_driver}
            disabled={disabled || !!state.lockedDriverId}
            aria-invalid={state.issue?.field === 'default_driver'}
            onChange={(event) => state.changeDefault(event.target.value)}
          >
            {options(draft.default_driver)}
          </select>
          {state.issue?.field === 'default_driver' && state.issue.kind !== 'locked' && (
            <p className="mt-1 text-body text-danger-soft">{state.issue.message}</p>
          )}
          {state.lockedDriverId && (
            <p className="mt-1 flex items-center gap-1 text-body text-fg-muted">
              <LockKeyhole className="h-3.5 w-3.5" aria-hidden /> 默认驱动由部署配置锁定
            </p>
          )}
          <p className="mt-1 text-body text-fg-muted">
            改默认值会保留下表当前选项；角色选为默认驱动时，后端会合并为跟随默认。
          </p>

          <div className="mt-4 border-t border-edge">
            {snapshot.roles.length === 0 ? (
              <p className="py-3 text-body text-fg-muted">
                当前没有可显示的角色映射，仍可设置默认驱动。
              </p>
            ) : (
              snapshot.roles.map((role, index) => {
                const field = `roles.${role.role_id}`;
                const value = draft.roles[role.role_id] ?? role.driver_id;
                return (
                  <div
                    key={role.role_id}
                    className="grid gap-2 border-b border-edge py-3 sm:grid-cols-2"
                  >
                    <div className="min-w-0">
                      <label
                        htmlFor={`${id}-role-${index}`}
                        className="block break-all font-mono text-code text-fg-primary"
                      >
                        {role.role_id}
                      </label>
                      <p className="break-all text-body text-fg-muted">
                        当前：{role.effective_driver_id} ·{' '}
                        {role.source === 'default' ? '跟随默认' : '独立映射'}
                      </p>
                      {!role.known_role && (
                        <p
                          className="text-body text-fg-muted"
                          title="角色不在当前目录中，也可能是目录查询失败；保存会保留这条映射。"
                        >
                          目录未确认 · 保留映射
                        </p>
                      )}
                    </div>
                    <div className="min-w-0">
                      <select
                        id={`${id}-role-${index}`}
                        value={value}
                        className={selectClass}
                        disabled={disabled}
                        aria-invalid={state.issue?.field === field}
                        onChange={(event) => state.changeRole(role.role_id, event.target.value)}
                      >
                        {options(value)}
                      </select>
                      {state.issue?.field === field && (
                        <p className="mt-1 text-body text-danger-soft">{state.issue.message}</p>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <details className="mt-3 text-body text-fg-muted">
            <summary className="cursor-pointer focus-visible:outline-command-soft">
              驱动说明
            </summary>
            <p className="mt-2">“CLI 就绪未验证”不是故障；选项是否可选择由后端单独判定。</p>
            {snapshot.drivers.map((driver) => (
              <div key={driver.driver_id} className="mt-2">
                <p className="font-mono text-code text-fg-secondary">{driverLabel(driver)}</p>
                {driver.description && <p>{driver.description}</p>}
                {driver.limitations?.map((limitation, index) => (
                  <p key={index}>{limitation}</p>
                ))}
              </div>
            ))}
          </details>
        </>
      ) : null}

      {state.issue && (
        <div
          className={`mt-3 rounded-panel border p-3 text-body ${
            conflict || state.issue.kind === 'busy' || state.issue.kind === 'locked'
              ? 'border-human/30 text-human-soft'
              : 'border-danger/30 text-danger-soft'
          }`}
          role="alert"
        >
          <p>{state.issue.message}</p>
          {state.conflict && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" disabled={state.busy} onClick={() => state.resolveConflict(false)}>
                使用最新配置
              </Button>
              <Button size="sm" disabled={state.busy} onClick={() => state.resolveConflict(true)}>
                保留我的改动
              </Button>
            </div>
          )}
          {state.pending && (
            <Button
              size="sm"
              className="mt-2"
              disabled={state.busy}
              onClick={() => void state.retry()}
            >
              重试同一请求
            </Button>
          )}
        </div>
      )}
      {state.notice && (
        <p className="mt-3 text-body text-fg-secondary" role="status">
          {state.notice}
        </p>
      )}

      {available && snapshot && draft && (
        <>
          {confirmReset ? (
            <div className="mt-3 rounded-panel border border-edge-strong p-3 text-body text-fg-secondary">
              <p>删除本项目的界面覆盖，恢复配置文件中的默认值和角色分配？正在运行的任务不变。</p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" disabled={state.busy} onClick={() => setConfirmReset(false)}>
                  取消
                </Button>
                <Button
                  size="sm"
                  disabled={disabled}
                  onClick={() => void state.reset().then(() => setConfirmReset(false))}
                >
                  确认恢复
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap justify-between gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => setConfirmReset(true)}
              >
                恢复文件配置
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={disabled}
                onClick={() => void state.save()}
              >
                {state.busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} 保存路由
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
