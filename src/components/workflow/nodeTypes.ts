import { LaneNode, StepNode } from '@/components/workflow/nodes';

/**
 * React Flow 自定义节点注册表：step 步骤卡 / lane 泳道底板。
 *
 * 为什么单独一个文件：注册表是个普通对象，不是组件。它和组件同处一个文件时，
 * Fast Refresh 会因为「这个模块导出了非组件」而对整个模块走全量刷新 ——
 * 改一行节点样式就整页重载（eslint react-refresh/only-export-components 报的就是这个）。
 *
 * 必须是模块级常量：xyflow 要求 nodeTypes 引用稳定，每次渲染新建一个对象会让它把所有节点全部重挂载。
 */
export const nodeTypes = {
  step: StepNode,
  lane: LaneNode,
};
