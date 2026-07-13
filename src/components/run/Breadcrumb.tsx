/**
 * 面包屑 —— 定位，不是状态。
 *
 * 所以它**不计入 L1 的七个信息单元**：它回答「我在哪」，不回答「发生了什么」。
 * 20px 一行，安静到几乎看不见；一旦它开始抢戏，主句就输了。
 */
export function Breadcrumb({ projectName, taskTitle }: { projectName: string; taskTitle: string }) {
  return (
    <nav aria-label="位置" className="flex items-center gap-1.5 text-body text-fg-muted">
      <span className="truncate">{projectName}</span>
      <span aria-hidden className="text-fg-faint">
        /
      </span>
      <span className="truncate text-fg-secondary">{taskTitle}</span>
    </nav>
  );
}
