import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { AuthBanner } from '@/components/AuthBanner';
import { HelpDrawer } from '@/components/HelpDrawer';
import { SettingsDialog } from '@/components/SettingsDialog';
import { AgentBoard } from '@/pages/AgentBoard';
import { TaskBoard } from '@/pages/TaskBoard';
import { CouncilBoard } from '@/pages/CouncilBoard';
import { FileViewer } from '@/pages/FileViewer';
import { ProjectLauncher } from '@/pages/ProjectLauncher';
import { useDemoStore } from '@/store/useDemoStore';
import { bootstrapBackend } from '@/api/system';
import { taskApi, watchTask } from '@/api/task';
import { runApi } from '@/api/run';
import { createRequirementTask } from '@/data/tasks';
import { taskToState } from '@/store/lib/taskSync';

export default function App() {
  const activeProjectId = useDemoStore((s) => s.activeProjectId);
  const currentPage = useDemoStore((s) => s.currentPage);
  const openHelp = useDemoStore((s) => s.openHelp);

  /**
   * 认证提示条必须挂在**最顶层**，不能挂在 AppShell 里。
   *
   * 新用户第一眼看到的是启动页（ProjectLauncher），而它完全在 AppShell 之外 ——
   * 提示条若挂在 AppShell 里，最需要看到它的人恰好看不到，而且启动页上连设置入口都没有。
   * 这正是「用户根本不知道自己需要哪些认证 token」的根源。
   */
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (!window.desktop?.backend) return;
    const subscriptions: Array<() => Promise<void>> = [];
    let cancelled = false;

    void bootstrapBackend()
      .then(() => taskApi.list())
      .then(async ({ tasks: snapshots }) => {
        if (cancelled) return;
        useDemoStore.setState((state) => {
          const known = new Set(state.tasks.map((task) => task.contractTaskId));
          const recovered = snapshots
            .filter((snapshot) => !known.has(snapshot.task.task_id))
            .map((snapshot) => ({
              ...createRequirementTask(
                snapshot.task.task_id,
                state.activeProjectId ?? 'backend',
                snapshot.task.spec,
                undefined,
                snapshot.task.completion_criteria,
              ),
              contractTaskId: snapshot.task.task_id,
              ...(snapshot.current_run
                ? { contractRunId: snapshot.current_run.run_id }
                : snapshot.run_history[0]
                  ? { contractRunId: snapshot.run_history[0].run_id }
                  : {}),
              assignedAgentIds: [
                snapshot.task.role_id,
                snapshot.task.owner_agent_id,
                snapshot.market?.winner_agent_id,
              ].filter((id): id is string => !!id),
            }));
          const recoveredRuns = Object.fromEntries(
            snapshots.flatMap((snapshot) => {
              const run = snapshot.current_run ?? snapshot.run_history[0];
              if (!run) return [];
              return [
                [
                  run.run_id,
                  {
                    runId: run.run_id,
                    taskId: run.task_id,
                    status: run.status === 'interrupted' ? ('failed' as const) : run.status,
                    timeline: [] as import('@/api/types/rpc').RunEvent[],
                    snapshot: null,
                    error: run.error?.message ?? null,
                  },
                ] as const,
              ];
            }),
          );
          const tasks = [...state.tasks, ...recovered];
          const shouldActivateRecovered = !state.activeTaskId && recovered.length > 0;
          const activeTask = shouldActivateRecovered ? recovered[0] : undefined;
          return {
            tasks,
            ...(activeTask
              ? {
                  activeTaskId: activeTask.id,
                  activeProjectId: activeTask.projectId,
                  currentPage: 'tasks' as const,
                  ...taskToState(activeTask),
                }
              : {}),
            liveRuns: { ...state.liveRuns, ...recoveredRuns },
            liveTasks: Object.fromEntries(
              snapshots.map((snapshot) => [
                snapshot.task.task_id,
                { snapshot, events: [], status: 'subscribing' as const },
              ]),
            ),
          };
        });

        for (const snapshot of snapshots) {
          const run = snapshot.current_run ?? snapshot.run_history[0];
          if (run) {
            void runApi.getSnapshot(run.run_id).then((runSnapshot) => {
              useDemoStore.setState((state) => {
                const current = state.liveRuns[run.run_id];
                return current
                  ? {
                      liveRuns: {
                        ...state.liveRuns,
                        [run.run_id]: {
                          ...current,
                          snapshot: runSnapshot,
                          timeline: runSnapshot.timeline,
                        },
                      },
                    }
                  : {};
              });
              useDemoStore.getState().attachLiveRun(run.run_id, runSnapshot);
            });
          }
          subscriptions.push(
            await watchTask(snapshot.task.task_id, {
              onSnapshot(nextSnapshot) {
                useDemoStore.setState((state) => ({
                  liveTasks: {
                    ...state.liveTasks,
                    [nextSnapshot.task.task_id]: {
                      ...(state.liveTasks[nextSnapshot.task.task_id] ?? { events: [] }),
                      snapshot: nextSnapshot,
                      status: 'live',
                    },
                  },
                }));
              },
              onEvent(event) {
                useDemoStore.setState((state) => {
                  const current = state.liveTasks[event.task_id];
                  if (!current) return {};
                  return {
                    liveTasks: {
                      ...state.liveTasks,
                      [event.task_id]: {
                        ...current,
                        events: [...current.events, event].sort(
                          (left, right) => left.sequence - right.sequence,
                        ),
                        cursor: event.event_id,
                        status: 'live',
                      },
                    },
                  };
                });
              },
            }),
          );
        }
      })
      .catch((error: unknown) => {
        console.warn('[backend] RPC bootstrap failed:', error);
      });

    return () => {
      cancelled = true;
      for (const unsubscribe of subscriptions) void unsubscribe();
    };
  }, []);

  /**
   * 原生菜单的应用内导航（仅 macOS 有菜单栏；Win/Linux 是 `setApplicationMenu(null)`）。
   *
   * 帮助**不开新窗口、不开浏览器** —— 菜单推来一个路由，打开的是同一个应用内抽屉。
   * `openHelp` 收到的 `help/python-terminal` 由 `parseHelpTopic` 剥前缀，前缀不在这里各剥一次。
   * 必须返回取消订阅函数：preload 是按通道 `removeListener` 的，漏掉就是一个泄漏的监听器。
   */
  useEffect(() => {
    const unsubscribe = window.desktop?.menu?.onNavigate((route) => {
      if (route.startsWith('help/')) openHelp(route);
    });
    return unsubscribe;
  }, [openHelp]);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <AuthBanner
        onConfigure={() => {
          setSettingsOpen(true);
        }}
      />

      <div className="min-h-0 flex-1">
        {!activeProjectId ? (
          <ProjectLauncher />
        ) : (
          <AppShell>
            {currentPage === 'agents' && <AgentBoard />}
            {currentPage === 'tasks' && <TaskBoard />}
            {currentPage === 'council' && <CouncilBoard />}
            {currentPage === 'file' && <FileViewer />}
          </AppShell>
        )}
      </div>

      {/* 启动页上也要能打开设置 —— 否则用户点了提示条却没地方填 key */}
      <SettingsDialog
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
        }}
      />

      {/*
       * 帮助抽屉挂在 ProjectLauncher 与 AppShell **之上** —— 它必须在**每一屏**都能开
       * （首次运行的用户就在启动页上）。560px、无遮罩：读文档时最常做的动作是**对照界面**，
       * 背后的 run 要继续跑、终端要继续输出。
       */}
      <HelpDrawer />
    </div>
  );
}
