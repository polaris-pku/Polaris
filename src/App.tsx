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
