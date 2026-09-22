/**
 * 股息筛选 · 表头列配置（纯函数，无 DOM / 无上游依赖）
 *
 * 值模型与全站页签配置（use-tab-config）同构：`order` 是完整排列（决定列顺序），
 * `hidden` 是其中不显示的键。用户配置与代码声明的列集合做**并集归一**：
 * 代码新增的列自动追加到末尾（新功能不被旧配置吞掉），配置里的未知键剔除
 * （删掉的列不残留幽灵项）。
 */

/** 表头配置的持久化形状（settings 键 `columns` 的值） */
export interface DividendColumnConfig {
  /** 完整列顺序（含隐藏列，决定显示顺序） */
  order: string[];
  /** 隐藏列的键集合 */
  hidden: string[];
}

/**
 * 归一列配置（纯函数）
 * @param raw settings 里存的原始值（可能是任意损坏形状）
 * @param allKeys 代码声明的全部可配置列键（顺序即默认顺序）
 * @returns 归一后的配置（order 为全集，且至少保留一列可见）
 */
export const normalizeDividendColumnConfig = (
  raw: unknown,
  allKeys: readonly string[],
): DividendColumnConfig => {
  const known = new Set(allKeys);
  const saved =
    raw && typeof raw === 'object' ? (raw as { order?: unknown; hidden?: unknown }) : {};
  const savedOrder = Array.isArray(saved.order)
    ? saved.order.filter(
        (key): key is string => typeof key === 'string' && known.has(key),
      )
    : [];
  const savedHidden = Array.isArray(saved.hidden)
    ? new Set(
        saved.hidden.filter((key): key is string => typeof key === 'string' && known.has(key)),
      )
    : new Set<string>();

  // 顺序 = 已保存顺序在前 + 代码新增列追加在后（去重）
  const order = [...new Set([...savedOrder, ...allKeys])];

  // 至少保留一列可见：全部被隐藏时放行最后一列
  const hidden = order.filter((key) => savedHidden.has(key));
  if (hidden.length >= order.length) hidden.pop();

  return { order, hidden };
};

/**
 * 从归一配置取可见列键（按 order 顺序）
 * @param config 归一配置
 * @returns 可见列键列表
 */
export const visibleDividendColumns = (config: DividendColumnConfig): string[] =>
  config.order.filter((key) => !config.hidden.includes(key));
