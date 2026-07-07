// 应用版本号：直接取自 package.json 的 version 字段。
// 命名导入 + resolveJsonModule，Vite 在 dev 与 build 下都会内联该值。
import { version } from '../../package.json';

export const APP_VERSION: string = version;
