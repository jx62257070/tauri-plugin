/**
 * 插件 dsh-dividend-screen（股息筛选）· 可配置规则引擎（纯函数）
 *
 * 两组语义：
 * - **筛选（filter）**：全部启用规则须满足才保留（AND）；
 * - **排除（exclude）**：任一启用规则命中即剔除并标原因（OR）——
 *   「伪高股息剔除」的语义载体。
 *
 * 判定三值：`true` 命中 / `false` 不命中 / `null` **数据缺失**。
 * 缺失的语义不对称：筛选规则视为未满足（宁缺勿滥）、排除规则视为不命中
 * （数据缺失不能当罪名）。
 *
 * 默认预置即用户给的清单：TTM 股息率 > 4% ∧ 总市值 ≥ 100 亿 ∧ 连续 5 年分红 ∧
 * 分红率 30~70% ∧ 经营现金流覆盖分红 ∧ 负债率 < 60% ∧ 非周期顶点（行业关键词 + 盈利塌陷两层代理）。
 *
 * 全部指标在扫描时已算好落库（`DividendScreenRow`），规则评估是纯客户端的，
 * 改规则不触发任何网络请求。
 */
import {
  RULE_CYCLICAL_KEYWORDS_DEFAULT,
  RULE_MARKET_CAP_MIN_DEFAULT_YI,
  RULE_GROUP_EXCLUDE,
  RULE_GROUP_FILTER,
  YI_TO_YUAN,
} from './constants';
import type { RuleConfig, RuleGroup, RuleMatchResult, RuleParamField, RuleParams, RuleVerdict } from './types';
import type { DividendScreenRow } from './types';

/** 规则类型键 */
export const DIVIDEND_RULE_TYPE = {
  /** 筛选：TTM 股息率 > X% */
  MIN_TTM_YIELD: 'min_ttm_yield',
  /** 筛选：连续分红年数 ≥ X 年 */
  MIN_DIVIDEND_YEARS: 'min_dividend_years',
  /** 筛选：去年分红率介于 X~Y%（含端点） */
  PAYOUT_RATIO_RANGE: 'payout_ratio_range',
  /** 筛选：去年经营现金流 ÷ 分红总额 ≥ X 倍 */
  CASH_COVER_MIN: 'cash_cover_min',
  /** 筛选：总市值 ≥ X 亿元 */
  MIN_MARKET_CAP: 'min_market_cap',
  /** 筛选：资产负债率 ≤ X% */
  MAX_DEBT_RATIO: 'max_debt_ratio',
  /** 筛选：推算今年股息率 > X%（预置外维度） */
  MIN_PROJECTED_YIELD: 'min_projected_yield',
  /** 筛选：去年股息率 > X%（预置外维度） */
  MIN_YIELD_LAST: 'min_yield_last',
  /** 筛选：去年每股分红 > X 元（预置外维度） */
  MIN_DPS_LAST: 'min_dps_last',
  /** 筛选：PE(TTM) ≤ X（预置外维度） */
  MAX_PE: 'max_pe',
  /** 筛选：市净率 ≤ X（预置外维度） */
  MAX_PB: 'max_pb',
  /** 筛选：中报净利同比 ≥ X%（预置外维度） */
  MIN_NP_YOY: 'min_np_yoy',
  /** 筛选：中报营收同比 ≥ X%（预置外维度） */
  MIN_REV_YOY: 'min_rev_yoy',
  /** 筛选：今年中期已宣派分红（预置外维度） */
  HAS_INTERIM_DIVIDEND: 'has_interim_dividend',
  /** 筛选：行业含指定关键词（只看，预置外维度） */
  INDUSTRY_WHITELIST: 'industry_whitelist',
  /** 排除：行业含周期关键词（周期顶点代理①） */
  INDUSTRY_BLACKLIST: 'industry_blacklist',
  /** 排除：中报净利同比 < X%（盈利塌陷，高息不可持续，周期顶点代理②） */
  MAX_INTERIM_DECLINE: 'max_interim_decline',
  /** 排除：去年分红率 > X%（透支型特别分红） */
  MAX_PAYOUT_OVERDUE: 'max_payout_overdue',
  /** 排除：每股经营现金流为负（分红不靠真金白银） */
  NEGATIVE_OCF: 'negative_ocf',
} as const;

/** 规则类型键类型 */
export type RuleTypeKey = (typeof DIVIDEND_RULE_TYPE)[keyof typeof DIVIDEND_RULE_TYPE];

/** 单条规则类型定义（评估函数纯函数，参数来自实例配置） */
export interface RuleTypeDef {
  /** 类型键 */
  key: RuleTypeKey;
  /** 展示名（规则行与添加下拉用） */
  label: string;
  /** 一句话说明（添加下拉的选项副文本） */
  description: string;
  /** 添加到面板时的默认分组 */
  defaultGroup: RuleGroup;
  /** 参数字段（空数组 = 无参数规则） */
  params: readonly RuleParamField[];
  /**
   * 评估（纯函数）
   * @param row 落库展示行
   * @param params 参数（缺键回退字段默认值）
   * @returns true 命中 / false 不命中 / null 数据缺失
   */
  evaluate: (row: DividendScreenRow, params: RuleParams) => RuleVerdict;
}

/**
 * 读数值参数（缺键 / 非有限数回退默认）
 * @param params 参数表
 * @param fields 该类型的参数字段
 * @param key 参数键
 * @returns 数值
 */
const numParam = (params: RuleParams, fields: readonly RuleParamField[], key: string): number => {
  const field = fields.find((item) => item.key === key);
  const fallback = typeof field?.fallback === 'number' ? field.fallback : 0;
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

/**
 * 读文本参数（缺键 / 非串回退默认）
 * @param params 参数表
 * @param fields 该类型的参数字段
 * @param key 参数键
 * @returns 文本
 */
const textParam = (params: RuleParams, fields: readonly RuleParamField[], key: string): string => {
  const field = fields.find((item) => item.key === key);
  const fallback = typeof field?.fallback === 'string' ? field.fallback : '';
  const value = params[key];
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
};

/** 规则类型注册表（评估全部纯函数；新增规则类型在此登记，UI 与持久化自动跟上） */
export const RULE_TYPE_REGISTRY: Readonly<Record<RuleTypeKey, RuleTypeDef>> = {
  [DIVIDEND_RULE_TYPE.MIN_TTM_YIELD]: {
    key: DIVIDEND_RULE_TYPE.MIN_TTM_YIELD,
    label: 'TTM 股息率高于',
    description: '东财口径：近 12 个月已实施派息 ÷ 现价',
    defaultGroup: RULE_GROUP_FILTER,
    params: [{ key: 'min', label: '股息率大于', kind: 'number', fallback: 4, unit: '%' }],
    evaluate: (row, params) =>
      row.ttmYield === null ? null : row.ttmYield > numParam(params, RULE_TYPE_REGISTRY[DIVIDEND_RULE_TYPE.MIN_TTM_YIELD].params, 'min'),
  },
  [DIVIDEND_RULE_TYPE.MIN_DIVIDEND_YEARS]: {
    key: DIVIDEND_RULE_TYPE.MIN_DIVIDEND_YEARS,
    label: '连续分红年数不少于',
    description: '从去年年报往前数连续有现金分红的年度数',
    defaultGroup: RULE_GROUP_FILTER,
    params: [{ key: 'min', label: '连续年数至少', kind: 'number', fallback: 5, unit: '年' }],
    evaluate: (row, params) =>
      row.dividendYears === null
        ? null
        : row.dividendYears >= numParam(params, RULE_TYPE_REGISTRY[DIVIDEND_RULE_TYPE.MIN_DIVIDEND_YEARS].params, 'min'),
  },
  [DIVIDEND_RULE_TYPE.PAYOUT_RATIO_RANGE]: {
    key: DIVIDEND_RULE_TYPE.PAYOUT_RATIO_RANGE,
    label: '去年分红率介于',
    description: '过高透支、过低抠门；30~70% 是「赚了就分、分了不伤身」的常见带',
    defaultGroup: RULE_GROUP_FILTER,
    params: [
      { key: 'min', label: '下限', kind: 'number', fallback: 30, unit: '%' },
      { key: 'max', label: '上限', kind: 'number', fallback: 70, unit: '%' },
    ],
    evaluate: (row, params) => {
      if (row.payoutLast === null) return null;
      const fields = RULE_TYPE_REGISTRY[DIVIDEND_RULE_TYPE.PAYOUT_RATIO_RANGE].params;
      const payoutPercent = row.payoutLast * 100;
      return payoutPercent >= numParam(params, fields, 'min') && payoutPercent <= numParam(params, fields, 'max');
    },
  },
  [DIVIDEND_RULE_TYPE.CASH_COVER_MIN]: {
    key: DIVIDEND_RULE_TYPE.CASH_COVER_MIN,
    label: '经营现金流覆盖分红',
    description: '每股经营现金流 ÷ 每股分红（每股比值 = 总额比值，股本约掉）',
    defaultGroup: RULE_GROUP_FILTER,
    params: [{ key: 'min', label: '覆盖倍数至少', kind: 'number', fallback: 1, unit: '×' }],
    evaluate: (row, params) =>
      row.cashCoverLast === null
        ? null
        : row.cashCoverLast >= numParam(params, RULE_TYPE_REGISTRY[DIVIDEND_RULE_TYPE.CASH_COVER_MIN].params, 'min'),
  },
  [DIVIDEND_RULE_TYPE.MIN_MARKET_CAP]: {
    key: DIVIDEND_RULE_TYPE.MIN_MARKET_CAP,
    label: '总市值不低于',
    description: '微盘高息常是「股价跌出来的息」：流动性差、分红一停就杀估值',
    defaultGroup: RULE_GROUP_FILTER,
    params: [{ key: 'min', label: '市值至少', kind: 'number', fallback: RULE_MARKET_CAP_MIN_DEFAULT_YI, unit: '亿' }],
    evaluate: (row, params) => {
      if (row.marketCap === null) return null;
      const min = numParam(params, RULE_TYPE_REGISTRY[DIVIDEND_RULE_TYPE.MIN_MARKET_CAP].params, 'min');
      return row.marketCap >= min * YI_TO_YUAN;
    },
  },
  [DIVIDEND_RULE_TYPE.MAX_DEBT_RATIO]: {
    key: DIVIDEND_RULE_TYPE.MAX_DEBT_RATIO,
    label: '资产负债率不高于',
    description: '最新已披露报告期（中报优先，回退去年年报）',
    defaultGroup: RULE_GROUP_FILTER,
    params: [{ key: 'max', label: '负债率不超过', kind: 'number', fallback: 60, unit: '%' }],
    evaluate: (row, params) =>
      row.debtRatio === null
        ? null
        : row.debtRatio <= numParam(params, RULE_TYPE_REGISTRY[DIVIDEND_RULE_TYPE.MAX_DEBT_RATIO].params, 'max'),
  },
  // ---------- 预置之外的可用维度（用户自建规则用；注册即自动进添加下拉） ----------
  [DIVIDEND_RULE_TYPE.MIN_PROJECTED_YIELD]: {
    key: DIVIDEND_RULE_TYPE.MIN_PROJECTED_YIELD,
    label: '推算今年股息率高于',
    description: '本页自算口径：去年分红率 × 预计今年净利 ÷ 现市值',
    defaultGroup: RULE_GROUP_FILTER,
    params: [{ key: 'min', label: '推算股息率大于', kind: 'number', fallback: 5, unit: '%' }],
    evaluate: (row, params) =>
      row.projectedYield === null
        ? null
        : row.projectedYield >
          numParam(params, RULE_TYPE_REGISTRY[DIVIDEND_RULE_TYPE.MIN_PROJECTED_YIELD].params, 'min'),
  },
  [DIVIDEND_RULE_TYPE.MIN_YIELD_LAST]: {
    key: DIVIDEND_RULE_TYPE.MIN_YIELD_LAST,
    label: '去年股息率高于',
    description: '去年全年每股派息 ÷ 现价（静态口径）',
    defaultGroup: RULE_GROUP_FILTER,
    params: [{ key: 'min', label: '去年股息率大于', kind: 'number', fallback: 3, unit: '%' }],
    evaluate: (row, params) =>
      row.yieldLast === null
        ? null
        : row.yieldLast > numParam(params, RULE_TYPE_REGISTRY[DIVIDEND_RULE_TYPE.MIN_YIELD_LAST].params, 'min'),
  },
  [DIVIDEND_RULE_TYPE.MIN_DPS_LAST]: {
    key: DIVIDEND_RULE_TYPE.MIN_DPS_LAST,
    label: '去年每股分红高于',
    description: '按去年年度报告期的每股派息合计（含税，元）',
    defaultGroup: RULE_GROUP_FILTER,
    params: [{ key: 'min', label: '每股分红大于', kind: 'number', fallback: 0.3, unit: '元' }],
    evaluate: (row, params) =>
      row.dpsLast === null
        ? null
        : row.dpsLast > numParam(params, RULE_TYPE_REGISTRY[DIVIDEND_RULE_TYPE.MIN_DPS_LAST].params, 'min'),
  },
  [DIVIDEND_RULE_TYPE.MAX_PE]: {
    key: DIVIDEND_RULE_TYPE.MAX_PE,
    label: 'PE(TTM) 不高于',
    description: '估值垫：PE 太高的股息率往往经不起盈利波动',
    defaultGroup: RULE_GROUP_FILTER,
    params: [{ key: 'max', label: 'PE 不超过', kind: 'number', fallback: 25, unit: '' }],
    evaluate: (row, params) =>
      row.peTtm === null
        ? null
        : row.peTtm <= numParam(params, RULE_TYPE_REGISTRY[DIVIDEND_RULE_TYPE.MAX_PE].params, 'max'),
  },
  [DIVIDEND_RULE_TYPE.MAX_PB]: {
    key: DIVIDEND_RULE_TYPE.MAX_PB,
    label: '市净率不高于',
    description: '低 PB 是分红能力的资产端约束（资产虚高的高息会被过滤）',
    defaultGroup: RULE_GROUP_FILTER,
    params: [{ key: 'max', label: 'PB 不超过', kind: 'number', fallback: 3, unit: '' }],
    evaluate: (row, params) =>
      row.pb === null
        ? null
        : row.pb <= numParam(params, RULE_TYPE_REGISTRY[DIVIDEND_RULE_TYPE.MAX_PB].params, 'max'),
  },
  [DIVIDEND_RULE_TYPE.MIN_NP_YOY]: {
    key: DIVIDEND_RULE_TYPE.MIN_NP_YOY,
    label: '中报净利同比增长至少',
    description: '正面版盈利门槛：同比低于阈值不放行（与「剔除中报净利下滑」互补，阈值可设更高）',
    defaultGroup: RULE_GROUP_FILTER,
    params: [{ key: 'min', label: '同比至少', kind: 'number', fallback: 0, unit: '%' }],
    evaluate: (row, params) =>
      row.netProfitYoY === null
        ? null
        : row.netProfitYoY >= numParam(params, RULE_TYPE_REGISTRY[DIVIDEND_RULE_TYPE.MIN_NP_YOY].params, 'min'),
  },
  [DIVIDEND_RULE_TYPE.MIN_REV_YOY]: {
    key: DIVIDEND_RULE_TYPE.MIN_REV_YOY,
    label: '中报营收同比增长至少',
    description: '收入端确认景气（利润可以挤出来，收入更难伪装）',
    defaultGroup: RULE_GROUP_FILTER,
    params: [{ key: 'min', label: '同比至少', kind: 'number', fallback: 0, unit: '%' }],
    evaluate: (row, params) =>
      row.revenueYoY === null
        ? null
        : row.revenueYoY >= numParam(params, RULE_TYPE_REGISTRY[DIVIDEND_RULE_TYPE.MIN_REV_YOY].params, 'min'),
  },
  [DIVIDEND_RULE_TYPE.HAS_INTERIM_DIVIDEND]: {
    key: DIVIDEND_RULE_TYPE.HAS_INTERIM_DIVIDEND,
    label: '今年中期已宣派分红',
    description: '已有实际动作的确定性证据：中报披露了分红方案（未披露视为不满足）',
    defaultGroup: RULE_GROUP_FILTER,
    params: [],
    evaluate: (row) => (row.interimDps === null ? null : row.interimDps > 0),
  },
  [DIVIDEND_RULE_TYPE.INDUSTRY_WHITELIST]: {
    key: DIVIDEND_RULE_TYPE.INDUSTRY_WHITELIST,
    label: '只看指定行业',
    description: '行业名含任一关键词才保留（逗号分隔；留空 = 不限）',
    defaultGroup: RULE_GROUP_FILTER,
    params: [
      { key: 'keywords', label: '行业关键词（逗号分隔）', kind: 'text', fallback: '' },
    ],
    evaluate: (row, params) => {
      if (row.industry === '') return null;
      const keywords = textParam(params, RULE_TYPE_REGISTRY[DIVIDEND_RULE_TYPE.INDUSTRY_WHITELIST].params, 'keywords')
        .split(/[,，]/)
        .map((item) => item.trim())
        .filter((item) => item !== '');
      if (keywords.length === 0) return false;
      return keywords.some((keyword) => row.industry.includes(keyword));
    },
  },
  [DIVIDEND_RULE_TYPE.INDUSTRY_BLACKLIST]: {
    key: DIVIDEND_RULE_TYPE.INDUSTRY_BLACKLIST,
    label: '剔除周期行业',
    description: '行业名含任一关键词即命中（周期顶点代理①：高息常是景气回落的价格陷阱）',
    defaultGroup: RULE_GROUP_EXCLUDE,
    params: [
      { key: 'keywords', label: '关键词（逗号分隔）', kind: 'text', fallback: RULE_CYCLICAL_KEYWORDS_DEFAULT },
    ],
    evaluate: (row, params) => {
      if (row.industry === '') return null;
      const keywords = textParam(params, RULE_TYPE_REGISTRY[DIVIDEND_RULE_TYPE.INDUSTRY_BLACKLIST].params, 'keywords')
        .split(/[,，]/)
        .map((item) => item.trim())
        .filter((item) => item !== '');
      if (keywords.length === 0) return false;
      return keywords.some((keyword) => row.industry.includes(keyword));
    },
  },
  [DIVIDEND_RULE_TYPE.MAX_INTERIM_DECLINE]: {
    key: DIVIDEND_RULE_TYPE.MAX_INTERIM_DECLINE,
    label: '剔除中报净利下滑',
    description: '中报净利同比低于阈值即命中（盈利塌陷代理②：今年的高分息明年未必守得住）',
    defaultGroup: RULE_GROUP_EXCLUDE,
    params: [{ key: 'max', label: '同比低于', kind: 'number', fallback: 0, unit: '%' }],
    evaluate: (row, params) =>
      row.netProfitYoY === null
        ? null
        : row.netProfitYoY < numParam(params, RULE_TYPE_REGISTRY[DIVIDEND_RULE_TYPE.MAX_INTERIM_DECLINE].params, 'max'),
  },
  [DIVIDEND_RULE_TYPE.MAX_PAYOUT_OVERDUE]: {
    key: DIVIDEND_RULE_TYPE.MAX_PAYOUT_OVERDUE,
    label: '剔除超额分红',
    description: '去年分红率超阈值即命中（特别分红 / 透支型分红率不可线性外推）',
    defaultGroup: RULE_GROUP_EXCLUDE,
    params: [{ key: 'max', label: '分红率超过', kind: 'number', fallback: 100, unit: '%' }],
    evaluate: (row, params) => {
      if (row.payoutLast === null) return null;
      const fields = RULE_TYPE_REGISTRY[DIVIDEND_RULE_TYPE.MAX_PAYOUT_OVERDUE].params;
      return row.payoutLast * 100 > numParam(params, fields, 'max');
    },
  },
  [DIVIDEND_RULE_TYPE.NEGATIVE_OCF]: {
    key: DIVIDEND_RULE_TYPE.NEGATIVE_OCF,
    label: '剔除经营现金流为负',
    description: '分红靠融资或变卖资产而非经营造血（数据缺失不剔除）',
    defaultGroup: RULE_GROUP_EXCLUDE,
    params: [],
    evaluate: (row) => (row.ocfPerShareLast === null ? null : row.ocfPerShareLast < 0),
  },
};

/** 预置规则的实例 id 前缀（与用户自建规则区分开） */
const PRESET_RULE_ID_PREFIX = 'preset-';

/**
 * 生成一条规则实例（参数取类型默认值）
 * @param type 规则类型键
 * @param group 分组覆盖（缺省用类型默认分组）
 * @returns 规则实例
 */
export const createRuleInstance = (type: RuleTypeKey, group?: RuleGroup): RuleConfig => {
  const def = RULE_TYPE_REGISTRY[type];
  const params: RuleParams = {};
  for (const field of def.params) params[field.key] = field.fallback;
  return {
    id: `rule-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
    type,
    group: group ?? def.defaultGroup,
    enabled: true,
    params,
  };
};

/**
 * 默认预置规则（用户口径：「伪高股息剔除 + 真高股息筛选」清单）
 * @returns 预置规则实例数组（顺序即面板展示序）
 */
export const createDefaultRules = (): RuleConfig[] => [
  {
    id: `${PRESET_RULE_ID_PREFIX}ttm-yield`,
    type: DIVIDEND_RULE_TYPE.MIN_TTM_YIELD,
    group: RULE_GROUP_FILTER,
    enabled: true,
    params: { min: 4 },
  },
  {
    id: `${PRESET_RULE_ID_PREFIX}div-years`,
    type: DIVIDEND_RULE_TYPE.MIN_DIVIDEND_YEARS,
    group: RULE_GROUP_FILTER,
    enabled: true,
    params: { min: 5 },
  },
  {
    id: `${PRESET_RULE_ID_PREFIX}payout-range`,
    type: DIVIDEND_RULE_TYPE.PAYOUT_RATIO_RANGE,
    group: RULE_GROUP_FILTER,
    enabled: true,
    params: { min: 30, max: 70 },
  },
  {
    id: `${PRESET_RULE_ID_PREFIX}cash-cover`,
    type: DIVIDEND_RULE_TYPE.CASH_COVER_MIN,
    group: RULE_GROUP_FILTER,
    enabled: true,
    params: { min: 1 },
  },
  {
    id: `${PRESET_RULE_ID_PREFIX}market-cap`,
    type: DIVIDEND_RULE_TYPE.MIN_MARKET_CAP,
    group: RULE_GROUP_FILTER,
    enabled: true,
    params: { min: RULE_MARKET_CAP_MIN_DEFAULT_YI },
  },
  {
    id: `${PRESET_RULE_ID_PREFIX}debt-ratio`,
    type: DIVIDEND_RULE_TYPE.MAX_DEBT_RATIO,
    group: RULE_GROUP_FILTER,
    enabled: true,
    params: { max: 60 },
  },
  {
    id: `${PRESET_RULE_ID_PREFIX}cyclical-industry`,
    type: DIVIDEND_RULE_TYPE.INDUSTRY_BLACKLIST,
    group: RULE_GROUP_EXCLUDE,
    enabled: true,
    params: { keywords: RULE_CYCLICAL_KEYWORDS_DEFAULT },
  },
  {
    id: `${PRESET_RULE_ID_PREFIX}interim-decline`,
    type: DIVIDEND_RULE_TYPE.MAX_INTERIM_DECLINE,
    group: RULE_GROUP_EXCLUDE,
    enabled: true,
    params: { max: 0 },
  },
  {
    id: `${PRESET_RULE_ID_PREFIX}payout-overdue`,
    type: DIVIDEND_RULE_TYPE.MAX_PAYOUT_OVERDUE,
    group: RULE_GROUP_EXCLUDE,
    enabled: true,
    params: { max: 100 },
  },
  {
    id: `${PRESET_RULE_ID_PREFIX}negative-ocf`,
    type: DIVIDEND_RULE_TYPE.NEGATIVE_OCF,
    group: RULE_GROUP_EXCLUDE,
    enabled: true,
    params: {},
  },
];

/**
 * 清洗从库里读回的规则配置（未知类型 / 非对象行丢弃，参数缺键补默认、类型错回退）
 * @param raw 库里读回的任意值（应为 `RuleConfig[]` 的 JSON 反序列化结果）
 * @returns 清洗后的规则配置（输入非法返回 null，由调用方决定是否回退预置）
 */
export const sanitizeRuleConfigs = (raw: unknown): RuleConfig[] | null => {
  if (!Array.isArray(raw)) return null;
  const configs: RuleConfig[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Partial<RuleConfig>;
    const def = RULE_TYPE_REGISTRY[candidate.type as RuleTypeKey];
    if (!def) continue;
    const group: RuleGroup = candidate.group === RULE_GROUP_FILTER || candidate.group === RULE_GROUP_EXCLUDE
      ? candidate.group
      : def.defaultGroup;
    const params: RuleParams = {};
    for (const field of def.params) {
      const value = (candidate.params ?? {})[field.key];
      if (field.kind === 'number') {
        params[field.key] =
          typeof value === 'number' && Number.isFinite(value) ? value : (field.fallback as number);
      } else {
        params[field.key] = typeof value === 'string' ? value : (field.fallback as string);
      }
    }
    configs.push({
      id: typeof candidate.id === 'string' && candidate.id !== '' ? candidate.id : createRuleInstance(def.key).id,
      type: def.key,
      group,
      enabled: candidate.enabled !== false,
      params,
    });
  }
  return configs;
};

/**
 * 渲染一条规则的展示文案（含参数值与单位）
 * @param config 规则实例
 * @returns 展示文案（如 `TTM 股息率 > 4%`）
 */
export const formatRuleText = (config: RuleConfig): string => {
  const def = RULE_TYPE_REGISTRY[config.type as RuleTypeKey];
  if (!def) return config.type;
  const unitOf = (key: string): string => def.params.find((field) => field.key === key)?.unit ?? '';
  const numOf = (key: string): string => {
    const field = def.params.find((item) => item.key === key);
    const value = typeof config.params[key] === 'number' ? (config.params[key] as number) : (field?.fallback as number);
    return `${value}${unitOf(key)}`;
  };
  const textOf = (key: string): string => {
    const field = def.params.find((item) => item.key === key);
    return typeof config.params[key] === 'string' ? (config.params[key] as string) : (field?.fallback as string);
  };
  switch (def.key) {
    case DIVIDEND_RULE_TYPE.MIN_TTM_YIELD:
      return `TTM 股息率 > ${numOf('min')}`;
    case DIVIDEND_RULE_TYPE.MIN_DIVIDEND_YEARS:
      return `连续分红 ≥ ${numOf('min')}`;
    case DIVIDEND_RULE_TYPE.PAYOUT_RATIO_RANGE:
      return `分红率 ${numOf('min')} ~ ${numOf('max')}`;
    case DIVIDEND_RULE_TYPE.CASH_COVER_MIN:
      return `现金流覆盖分红 ≥ ${numOf('min')}`;
    case DIVIDEND_RULE_TYPE.MIN_MARKET_CAP:
      return `总市值 ≥ ${numOf('min')}`;
    case DIVIDEND_RULE_TYPE.MIN_PROJECTED_YIELD:
      return `推算股息率 > ${numOf('min')}`;
    case DIVIDEND_RULE_TYPE.MIN_YIELD_LAST:
      return `去年股息率 > ${numOf('min')}`;
    case DIVIDEND_RULE_TYPE.MIN_DPS_LAST:
      return `每股分红 > ${numOf('min')}`;
    case DIVIDEND_RULE_TYPE.MAX_PE:
      return `PE(TTM) ≤ ${numOf('max')}`;
    case DIVIDEND_RULE_TYPE.MAX_PB:
      return `PB ≤ ${numOf('max')}`;
    case DIVIDEND_RULE_TYPE.MIN_NP_YOY:
      return `净利同比 ≥ ${numOf('min')}`;
    case DIVIDEND_RULE_TYPE.MIN_REV_YOY:
      return `营收同比 ≥ ${numOf('min')}`;
    case DIVIDEND_RULE_TYPE.HAS_INTERIM_DIVIDEND:
      return '中期已宣派分红';
    case DIVIDEND_RULE_TYPE.INDUSTRY_WHITELIST: {
      const keywords = textOf('keywords').trim();
      return keywords === '' ? '只看指定行业（未设关键词 = 全部通过）' : `行业含 [${keywords}]`;
    }
    case DIVIDEND_RULE_TYPE.MAX_DEBT_RATIO:
      return `负债率 ≤ ${numOf('max')}`;
    case DIVIDEND_RULE_TYPE.INDUSTRY_BLACKLIST:
      return `行业含 [${textOf('keywords')}]`;
    case DIVIDEND_RULE_TYPE.MAX_INTERIM_DECLINE:
      return `中报净利同比 < ${numOf('max')}`;
    case DIVIDEND_RULE_TYPE.MAX_PAYOUT_OVERDUE:
      return `分红率 > ${numOf('max')}（超额）`;
    case DIVIDEND_RULE_TYPE.NEGATIVE_OCF:
      return '经营现金流 < 0';
    default:
      return def.label;
  }
};

/**
 * 对一行数据评估全部启用规则（纯函数）
 *
 * 语义：无启用规则 = 通过；排除组任一命中 → 不通过（带原因）；
 * 筛选组任一未满足（含数据缺失）→ 不通过（带原因）。
 * @param row 落库展示行
 * @param configs 规则配置（只评估 `enabled` 的）
 * @returns 匹配结果
 */
export const evaluateRules = (row: DividendScreenRow, configs: readonly RuleConfig[]): RuleMatchResult => {
  const excludeReasons: string[] = [];
  const failedFilters: string[] = [];
  for (const config of configs) {
    if (!config.enabled) continue;
    const def = RULE_TYPE_REGISTRY[config.type as RuleTypeKey];
    if (!def) continue;
    const verdict = def.evaluate(row, config.params);
    const text = formatRuleText(config);
    if (config.group === RULE_GROUP_EXCLUDE) {
      // 排除组：数据缺失（null）不当罪名，只有明确 true 才剔除
      if (verdict === true) excludeReasons.push(text);
    } else if (verdict !== true) {
      // 筛选组：false 或数据缺失都不放行（宁缺勿滥）
      failedFilters.push(verdict === null ? `${text}（数据缺失）` : text);
    }
  }
  return {
    pass: excludeReasons.length === 0 && failedFilters.length === 0,
    excludeReasons,
    failedFilters,
  };
};
