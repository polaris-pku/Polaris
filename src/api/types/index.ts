// 跨方向 API 契约镜像 —— 对齐 A（acp-client-prototype）与 BCD（newide-scaffold）v0 契约。
export * from './core'; // 共享基础：ID/事件/制品/引用/租约/决策
export * from './coord'; // 方向 C：Task/Run/AgentSession/Checkpoint/Message
export * from './council'; // 方向 C：Council（v0 契约 + 前端前瞻类型）
export * from './gate'; // 方向 D：Hook 点位 / Gate
export * from './driver'; // 方向 A：Driver / ACP 接入契约
export * from './memory'; // 方向 B：ContextPack 记忆装配
export * from './agent'; // 方向 B：Persona/Metrics/DriverInfo 展示视图
export * from './fileops'; // 方向 E：文件读/写/建操作观测视图（消费 A/C/D）
export * from './snapshot'; // 方向 C：前端 Run 快照（frontend-snapshot.json v0）
