/** 唯一 id：Date.now 叠加自增序号，避免同一毫秒内连续创建导致 id 冲突。 */
let idSeq = 0;
export const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${(idSeq++).toString(36)}`;
