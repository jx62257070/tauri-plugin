/**
 * 配置驱动表格的列定义
 */
export interface TableColumn<T> {
  /** 列键（同时是插槽名与默认取值字段名） */
  key: string;
  /** 表头文案 */
  label: string;
  /** 对齐方式，默认左对齐 */
  align?: 'left' | 'right' | 'center';
  /** 是否支持点击表头排序（需同时提供 sortValue），默认不支持 */
  sortable?: boolean;
  /** 排序取值函数（sortable: true 时必填；null/undefined 统一沉底） */
  sortValue?: (row: T) => number | string | null | undefined;
}
