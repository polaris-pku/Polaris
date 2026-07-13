import { useCallback, useEffect, useState } from 'react';
import { FolderSearch, MonitorX, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { RuntimeListItem } from '@/components/dock/RuntimeListItem';
import {
  cancelInstall,
  installRuntime,
  pickInterpreter,
  pythonAvailable,
  refreshPythonState,
  selectRuntime,
  selectedRuntime,
  uninstallRuntime,
  usePythonState,
} from '@/lib/pythonRuntime';
import {
  MANUAL_PICK_HINT,
  NO_RUNTIME_TEXT,
  PLATFORM_UNAVAILABLE_TEXT,
  formatBytes,
  uninstallConfirmText,
} from '@/lib/pythonFormat';
import { useDemoStore } from '@/store/useDemoStore';

/**
 * Dock 的「运行时」频道 —— Python 的探测 / 选择 / 一键安装 / 手动指定 / 卸载。
 *
 * ── 它最重要的一条路径不是「管理运行时」，而是「我点了运行，但没装 Python」──
 * 那种时候用户的意图是**跑这个文件**，不是配环境。所以这里不弹错误弹窗：Dock 就地切到本频道，
 * 顶部一条横幅说清「差什么、多大」，一个主按钮装完**自动接着跑他本来要跑的那个文件**。
 * 安装是中途插入的一步，不是打断后的另一件事 —— 意图不丢。
 *
 * 【R3/I5】这里确实会调 startTerminalRun，但它消费的是**用户那次点击**留下的一次性令牌
 * （pendingRunIntent），不是「安装完成就跑点什么」。令牌只能由用户手势写入，绝不能由
 * backend:event 写入 —— 否则 agent 往工作区写个 .py 就能让宿主替它执行。
 */
export function RuntimeChannel() {
  const state = usePythonState();
  const selected = selectedRuntime(state);
  const available = pythonAvailable();

  const intent = useDemoStore((s) => s.pendingRunIntent);
  const consumeRunIntent = useDemoStore((s) => s.consumeRunIntent);
  const startTerminalRun = useDemoStore((s) => s.startTerminalRun);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  // 有解释器了 + 手上还攥着用户的运行意图 → 把他本来要跑的那个文件接着跑掉。
  // 依赖 selected：安装完成 / 用户选中 / 手动指定，三条路都会让它从 null 变成有值。
  //
  // 过期判定**只在 consumeRunIntent() 里做一次**（terminalSlice 的 INTENT_TTL_MS）。
  // 这里不再抄一份 —— 两份 TTL 必然漂移，而且这条路径本来就只有一个消费者。
  useEffect(() => {
    if (!selected || !intent) return;
    const taken = consumeRunIntent();
    if (!taken) return;
    void startTerminalRun({
      projectName: taken.projectName,
      rootPath: taken.rootPath,
      relPath: taken.relPath,
    });
  }, [selected, intent, consumeRunIntent, startTerminalRun]);

  const onPick = useCallback(async () => {
    const result = await pickInterpreter();
    setManualError(result.ok ? null : (result.error ?? '这不像是一个可用的 Python'));
  }, []);

  if (!available) {
    return (
      <EmptyState
        icon={MonitorX}
        title="Python 运行时仅在桌面版可用"
        hint="浏览器里没有可以运行本机进程的能力。"
      />
    );
  }

  const installed = state.runtimes;
  const installable = state.catalog.filter((c) => !c.installed);
  const recommended = state.catalog.find((c) => c.recommended && !c.installed && !c.unavailable);
  // 空 catalog（还没拉到快照）不等于「此平台没有资产」—— 别在加载中的那一帧就下结论
  const platformUnavailable = state.catalog.length > 0 && state.catalog.every((c) => c.unavailable);
  const install = state.install;
  const installing = !!install && install.phase !== 'done' && install.phase !== 'error';

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* 「点了运行但没装 Python」——**不弹窗**，就地把差什么说清楚 */}
      {intent && !selected && (
        <div className="flex items-center gap-3 border-b border-human/30 bg-human/10 px-4 py-2">
          <p className="min-w-0 flex-1 text-body text-human-soft">
            运行 <span className="font-mono text-code">{intent.relPath}</span> 需要 Python。
            {recommended
              ? `装一份就行，约 ${formatBytes(recommended.downloadBytes)}。`
              : PLATFORM_UNAVAILABLE_TEXT}
          </p>
          {recommended && (
            <Button
              variant="primary"
              size="sm"
              disabled={installing}
              onClick={() => void installRuntime(recommended.catalogId)}
            >
              {`安装 Python ${recommended.version} 并运行`}
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-4 p-4">
        <section className="flex flex-col gap-2">
          <header className="flex items-center justify-between">
            <h3 className="text-title text-fg-primary">已安装</h3>
            <Button variant="ghost" size="sm" onClick={() => void refreshPythonState()}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              重新探测
            </Button>
          </header>

          {installed.length === 0 ? (
            <p className="text-body text-fg-muted">
              {NO_RUNTIME_TEXT}
              {platformUnavailable ? PLATFORM_UNAVAILABLE_TEXT : '可以在下面一键装一个。'}
            </p>
          ) : (
            installed.map((runtime) => (
              <div key={runtime.id} className="flex flex-col gap-2">
                <RuntimeListItem
                  row={{ kind: 'installed', runtime }}
                  selected={runtime.id === state.selectedId}
                  onSelect={() => void selectRuntime(runtime.id)}
                  actions={
                    runtime.removable ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setConfirmingId(runtime.id);
                        }}
                      >
                        删除
                      </Button>
                    ) : undefined
                  }
                />
                {/* 系统 Python 没有删除按钮 —— 不是我们装的，我们无权动它 */}
                {confirmingId === runtime.id && (
                  <div className="flex items-center gap-3 rounded-panel border border-human/30 bg-human/10 px-3 py-2">
                    <p className="min-w-0 flex-1 text-body text-human-soft">
                      {uninstallConfirmText(runtime)}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setConfirmingId(null);
                      }}
                    >
                      取消
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        setConfirmingId(null);
                        void uninstallRuntime(runtime.id);
                      }}
                    >
                      删除
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </section>

        {installable.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-title text-fg-primary">可安装</h3>
            {installable.map((item) => {
              const rowProgress = install && install.catalogId === item.catalogId ? install : null;
              return (
                <RuntimeListItem
                  key={item.catalogId}
                  row={{ kind: 'catalog', item }}
                  progress={rowProgress}
                  actions={
                    item.unavailable ? undefined : rowProgress && installing ? (
                      <Button variant="ghost" size="sm" onClick={() => void cancelInstall()}>
                        取消
                      </Button>
                    ) : (
                      <Button
                        variant={item.recommended ? 'primary' : 'secondary'}
                        size="sm"
                        disabled={installing}
                        onClick={() => void installRuntime(item.catalogId)}
                      >
                        安装
                      </Button>
                    )
                  }
                />
              );
            })}
          </section>
        )}

        <section className="flex flex-col gap-2 border-t border-edge pt-4">
          {manualOpen ? (
            <>
              <h3 className="text-title text-fg-primary">手动指定</h3>
              {/* 授权模型必须诚实地讲出来 —— 用户会问「为什么不让我直接填路径」 */}
              <p className="text-body text-fg-muted">{MANUAL_PICK_HINT}</p>
              {manualError && <p className="text-body text-danger">{manualError}</p>}
              <div>
                <Button variant="secondary" size="sm" onClick={() => void onPick()}>
                  <FolderSearch className="h-3.5 w-3.5" aria-hidden />
                  选择解释器…
                </Button>
              </div>
            </>
          ) : (
            <div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setManualOpen(true);
                }}
              >
                我已经有 Python
              </Button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
