import type { FileNode } from '@/types';

/**
 * 按路径把一个节点插入文件树（不可变）。
 * parts 为路径分段；isFolder 决定叶子是文件还是文件夹；中间层缺失会自动建文件夹。
 * 同名节点已存在则原样返回。
 * origin 标记叶子的来源（见 FileNode.origin）——真实 run 与演示剧本写进同一个工作区，
 * 能确知来源的必须标出来。
 */
export function insertFileNode(
  nodes: FileNode[],
  parts: string[],
  isFolder: boolean,
  origin?: FileNode['origin'],
): FileNode[] {
  const [head, ...rest] = parts;
  if (rest.length === 0) {
    if (nodes.some((n) => n.name === head)) return nodes;
    const leaf: FileNode = isFolder
      ? { name: head, children: [] }
      : { name: head, ...(origin ? { origin } : {}) };
    return [...nodes, leaf];
  }
  const idx = nodes.findIndex((n) => n.name === head && n.children);
  if (idx >= 0) {
    const copy = [...nodes];
    copy[idx] = {
      ...copy[idx],
      children: insertFileNode(copy[idx].children ?? [], rest, isFolder, origin),
    };
    return copy;
  }
  return [...nodes, { name: head, children: insertFileNode([], rest, isFolder, origin) }];
}

/** 按路径从文件树移除一个节点（不可变）。 */
export function removeFileNode(nodes: FileNode[], parts: string[]): FileNode[] {
  const [head, ...rest] = parts;
  if (rest.length === 0) return nodes.filter((n) => n.name !== head);
  return nodes.map((n) =>
    n.name === head && n.children ? { ...n, children: removeFileNode(n.children, rest) } : n,
  );
}
