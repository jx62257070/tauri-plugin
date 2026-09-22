/**
 * MCP 层类型（MCP 协议格式的统一抽象：内置进程内实现 + 远端 SDK 客户端）
 *
 * 内置 MCP 与远端 MCP（mcp_server 表，streamable-http / sse）对 Agent 而言
 * 是同一抽象：listTools 返回 MCP tools 描述（name / description / inputSchema
 * JSON Schema），callTool 接收参数返回 `McpCallToolResult`。区别仅在内置版是
 * 进程内直调（不经网络），且**不可删除、不可编辑**（用户约定：内置 MCP 不可删）。
 *
 * MCP Apps（SEP-1865）相关字段：
 * - 工具声明 `_meta.ui.resourceUri` = 调用该工具后由宿主渲染的 `ui://` 资源；
 * - 结果 `structuredContent` 进 UI（沙箱 iframe）但不进模型上下文，模型只拿
 *   `content` 里的文本块——避免把渲染数据重复塞进 token 预算；
 * - `McpUiResource` 即 `text/html;profile=mcp-app` 单文件 HTML，在
 *   `sandbox="allow-scripts"`（**不给 allow-same-origin**）的 iframe 内运行。
 */
import type { z } from 'zod';

/** MCP 内容块：文本（模型可见） */
export interface McpTextContent {
  type: 'text';
  text: string;
}

/** MCP 内容块：资源链接（指向 ui:// 等资源，不内联内容） */
export interface McpResourceLinkContent {
  type: 'resource_link';
  uri: string;
  name?: string;
  mimeType?: string;
  description?: string;
}

/** MCP 内容块：内联资源（HTML / 文本随结果直接带回） */
export interface McpEmbeddedResourceContent {
  type: 'resource';
  resource: { uri: string; mimeType: string; text: string };
}

/** MCP 内容块联合 */
export type McpContentBlock = McpTextContent | McpResourceLinkContent | McpEmbeddedResourceContent;

/**
 * MCP Apps UI 元数据（工具声明或结果上的 `_meta.ui`）
 *
 * 参考 SEP-1865：`resourceUri` 指向 `ui://` 资源；
 * `visibility` 控制该工具对模型 / UI 是否可见（默认模型可见）。
 */
export interface McpUiMeta {
  /** UI 资源地址（`ui://<server>/<app>` 形态） */
  resourceUri?: string;
  /** 可见性：model = 暴露给模型，app = 仅 UI 内部可调 */
  visibility?: ReadonlyArray<'model' | 'app'>;
  /** UI 偏好：是否绘制宿主边框（供宿主外观参考） */
  prefersBorder?: boolean;
}

/**
 * tools/call 结果（MCP `CallToolResult` 的进程内等价实现）
 *
 * - `content` 给模型（文本块会被拼接为工具返回文本）；
 * - `structuredContent` 只给 UI，不进模型上下文；
 * - `_meta.ui.resourceUri` 指定渲染该结果的 `ui://` 应用。
 */
export interface McpCallToolResult {
  content: McpContentBlock[];
  /** 结构化结果（仅 UI 消费，不返给模型） */
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: { ui?: McpUiMeta };
}

/** MCP 工具描述（MCP tools/list 单条格式：inputSchema 为 JSON Schema） */
export interface McpToolDefinition {
  /** 工具名（MCP server 内唯一；约定 snake_case） */
  name: string;
  /** 给模型看的用途说明 */
  description: string;
  /** 入参 JSON Schema（由 zod schema 推导，保持单一事实源） */
  inputSchema: Record<string, unknown>;
  /** 工具级 MCP Apps 声明（有则调用后宿主渲染对应 ui:// 应用） */
  _meta?: { ui?: McpUiMeta };
}

/** MCP Apps UI 资源（`text/html;profile=mcp-app` 单文件 HTML） */
export interface McpUiResource {
  /** 资源地址：`ui://<serverKey>/<appName>` */
  uri: string;
  /** 展示名（卡片标题用） */
  name: string;
  /** 资源可渲染的 MIME（MCP Apps 固定形态） */
  mimeType: 'text/html;profile=mcp-app';
  /** 单文件 HTML：沙箱内运行，禁止外部依赖（CSP 与可移植性要求） */
  html: string;
  /**
   * 允许该应用通过 `tools/call` 反向调用的工具名白名单（限同 server 内）
   * 缺省 = 不允许任何调用；写操作工具**一律不允许**由 UI 触发。
   */
  uiCallableTools?: readonly string[];
}

/** MCP 工具运行时条目 */
export interface McpToolEntry {
  /** 工具描述（含推导出的 JSON Schema 与 UI 声明） */
  definition: McpToolDefinition;
  /** 入参 zod schema（MCP inputSchema 的推导源，供 LangChain StructuredTool 复用） */
  schema: z.ZodType;
  /**
   * 执行工具（内置为进程内直调，远端为 tools/call 请求）
   * @param input 已通过 schema 校验的入参
   * @param signal 中止信号（agent 停止时透传，远端请求据此取消）
   * @returns MCP CallToolResult（content 给模型 / structuredContent 给 UI）
   */
  execute: (input: unknown, signal?: AbortSignal) => Promise<McpCallToolResult>;
  /** 是否允许 MCP App（iframe 内）通过 tools/call 反向调用；默认不允许 */
  uiCallable?: boolean;
}

/** 内置 MCP 服务器（静态声明，随应用常驻） */
export interface BuiltinMcpServer {
  /**
   * 授权用资源 id
   *
   * ⚠️ 内置服务器不在 `mcp_server` 表里，没有自增 id；沿用与内置 subagent 相同的
   * **负数 id 约定**，使其能与远端服务器（正数 id）共用 `resource_grant` 表授权。
   */
  id: number;
  /** 稳定 key（持久化 / 日志 / ui:// 前缀用，如 'app-api' / 'stock-sdk'） */
  key: string;
  /** 展示名 */
  name: string;
  /** 给用户看的说明（管理弹窗展示） */
  description: string;
  /** 工具集 */
  tools: McpToolEntry[];
  /** MCP Apps UI 资源（有则参与宿主资源解析） */
  uiResources?: readonly McpUiResource[];
}

/** 统一服务器适配器（内置 / 远端共用，供 registry 装配与宿主解析资源） */
export interface McpServerAdapter {
  /** 稳定 key（内置=常量 key；远端=`remote:<id>`） */
  key: string;
  /**
   * 授权用资源 id（对应 resource_grant.resource_id）
   *
   * 内置为负数常量 id（不在 mcp_server 表），远端为 mcp_server.id。
   */
  resourceId: number;
  /** 展示名 */
  name: string;
  /** 是否内置（内置不可删不可编辑） */
  builtin: boolean;
  /**
   * 列出工具（远端为 tools/list 请求）
   * @returns 工具条目列表
   */
  listTools: () => Promise<McpToolEntry[]>;
  /**
   * 读取 UI 资源（远端为 resources/read 请求）
   * @param uri 资源地址
   * @returns UI 资源；不存在或不可渲染时返回 null
   */
  readUiResource: (uri: string) => Promise<McpUiResource | null>;
  /** 释放连接（内置为空实现） */
  close?: () => Promise<void>;
}

/** 工具事件（运行期推给 UI 的工具卡数据源） */
export interface McpToolStartEvent {
  /** 调用 id（优先取模型的 tool_call id，缺失则本地生成） */
  id: string;
  /** 所属 server key（卡片徽标用） */
  serverKey: string;
  /** 工具名（不含 server 前缀） */
  toolName: string;
  /** 入参 JSON 字符串 */
  argsText: string;
}

/** 工具结束事件 */
export interface McpToolEndEvent {
  /** 与 start 相同的调用 id */
  id: string;
  /** 终态 */
  state: 'success' | 'error';
  /** 结果文本（错误时为错误信息） */
  resultText: string;
  /** 耗时毫秒 */
  durationMs: number;
  /** MCP Apps 渲染数据（工具声明了 ui:// 且成功时才有） */
  ui?: { resourceUri: string; payload: Record<string, unknown> };
}

/** 工具事件接收器（由 ChatPanel 提供，写入消息 parts） */
export interface McpToolEventSink {
  /**
   * 工具开始执行
   * @param event 开始事件
   */
  onStart: (event: McpToolStartEvent) => void;
  /**
   * 工具执行结束
   * @param event 结束事件
   */
  onEnd: (event: McpToolEndEvent) => void;
}

/** Agent 单次运行可用的 MCP 运行时（工具集 + UI 资源解析 + UI 反向调用） */
export interface McpRuntime {
  /**
   * 为一次运行装配 LangChain 工具集（工具事件经 sink 回推到消息 parts）
   * @param sink 工具事件接收器（ChatPanel 提供）
   * @returns StructuredTool 列表
   */
  createTools: (sink: McpToolEventSink) => unknown[];
  /**
   * 按 server key 分组装配工具（子 agent 级 MCP 白名单按组授权用）
   *
   * 每组带 `resourceId`（内置为负数常量 id，远端为 mcp_server.id），
   * 供调用方直接拿去比对 `resource_grant`，无需再解析 serverKey。
   *
   * ⚠️ 与 `createTools` **二选一**调用：注册名去重带副作用，两者同调会产生多余前缀名。
   * @param sink 工具事件接收器（ChatPanel 提供）
   * @returns 每台服务器的资源 id 与其 StructuredTool 列表
   */
  createToolsByServer: (
    sink: McpToolEventSink,
  ) => Array<{ serverKey: string; resourceId: number; tools: unknown[] }>;
  /** 参与装配的 server key 列表（诊断 / 展示用） */
  serverKeys: string[];
  /**
   * 解析 ui:// 资源（内置查表，远端走 resources/read）
   * @param uri 资源地址
   * @returns 可渲染的 UI 资源；不允许 / 不存在时 null
   */
  readUiResource: (uri: string) => Promise<McpUiResource | null>;
  /**
   * MCP App 反向调用工具（限该 App 所属 server 且命中 uiCallableTools 白名单）
   * @param uri 发起调用的 App 资源地址（用于定位 server 与白名单）
   * @param toolName 工具名
   * @param args 入参
   * @returns 工具结果
   */
  callUiTool: (uri: string, toolName: string, args: unknown) => Promise<McpCallToolResult>;
  /**
   * 释放远端连接
   * @returns 无
   */
  dispose: () => Promise<void>;
}
