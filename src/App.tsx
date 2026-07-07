import { AppShell } from '@/components/AppShell';
import { AgentBoard } from '@/pages/AgentBoard';
import { TaskBoard } from '@/pages/TaskBoard';
import { CouncilBoard } from '@/pages/CouncilBoard';
import { FileViewer } from '@/pages/FileViewer';
import { ProjectLauncher } from '@/pages/ProjectLauncher';
import { useDemoStore } from '@/store/useDemoStore';

export default function App() {
  const activeProjectId = useDemoStore((s) => s.activeProjectId);
  const currentPage = useDemoStore((s) => s.currentPage);

  if (!activeProjectId) {
    return <ProjectLauncher />;
  }

  return (
    <AppShell>
      {currentPage === 'agents' && <AgentBoard />}
      {currentPage === 'tasks' && <TaskBoard />}
      {currentPage === 'council' && <CouncilBoard />}
      {currentPage === 'file' && <FileViewer />}
    </AppShell>
  );
}
