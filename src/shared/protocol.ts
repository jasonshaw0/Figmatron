export const STAGES = [
  'prepare_context',
  'route',
  'model_call',
  'parse',
  'validate',
  'repair_if_needed',
  'insert_or_return',
  'done'
] as const;

export type StageName = (typeof STAGES)[number];

export type QueryMode = 'create' | 'modify' | 'ask' | 'vectorize';
export type RouteMode = 'direct_svg' | 'structured_ir';
export type RouteOverride = 'auto' | 'direct_svg' | 'structured_ir';
export type ResponseMode = 'text' | 'svg' | 'ir_json';

export interface SelectionInfo {
  count: number;
  hasSelection: boolean;
  primaryId?: string;
  primaryName?: string;
  primaryType?: string;
}

export interface SelectionMetadata {
  id: string;
  name: string;
  type: string;
  width: number;
  height: number;
  x: number;
  y: number;
  rotation: number;
  visible: boolean;
  locked: boolean;
  fillsCount: number;
  strokesCount: number;
}

export interface ContextPacket {
  svg?: string;
  metadata?: SelectionMetadata;
  screenshotPngBase64?: string;
  selectionInfo: SelectionInfo;
}

export interface ValidationReport {
  category: 'model' | 'parse' | 'validation' | 'insert' | 'canceled';
  errors: string[];
  warnings: string[];
  repairable: boolean;
}

export interface StageTimings {
  [key: string]: number;
}

export interface ExecutionTrace {
  requestId: string;
  mode: QueryMode;
  route: RouteMode;
  responseMode: ResponseMode;
  model: string;
  startedAt: number;
  endedAt?: number;
  totalMs?: number;
  stageTimingsMs: StageTimings;
  payloadSizes: {
    promptChars: number;
    contextSvgChars: number;
    screenshotBytes: number;
    responseChars: number;
  };
  contextSummary: {
    selectionCount: number;
    hasSvg: boolean;
    hasScreenshot: boolean;
  };
  validation?: ValidationReport;
  responsePreview?: string;
  repaired?: boolean;
  outcome?: 'success' | 'failed' | 'canceled';
  errorMessage?: string;
}

export interface DiagramNode {
  id: string;
  kind: 'block' | 'decision' | 'terminator' | 'io' | 'gate' | 'text';
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiagramEdge {
  id: string;
  from: string;
  to: string;
  fromSide?: 'top' | 'right' | 'bottom' | 'left';
  toSide?: 'top' | 'right' | 'bottom' | 'left';
  label?: string;
}

export interface DiagramIR {
  kind: 'diagram';
  canvas: {
    width: number;
    height: number;
    padding?: number;
  };
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  styles?: {
    stroke?: string;
    strokeWidth?: number;
    fill?: string;
    textColor?: string;
    fontSize?: number;
  };
}

export type PluginRequestMessage =
  | {
      type: 'prepare-context';
      requestId: string;
      mode: QueryMode;
      includeScreenshot: boolean;
    }
  | {
      type: 'insert-svg';
      requestId: string;
      svg: string;
      mode: QueryMode;
      route: RouteMode;
    }
  | {
      type: 'cancel-request';
      requestId: string;
    }
  | {
      type: 'resize-ui';
      width: number;
      height: number;
    };

export type PluginResponseMessage =
  | {
      type: 'selection-state';
      selection: SelectionInfo;
    }
  | {
      type: 'context-ready';
      requestId: string;
      context: ContextPacket;
      error?: string;
    }
  | {
      type: 'insert-result';
      requestId: string;
      success: boolean;
      error?: string;
    }
  | {
      type: 'request-canceled';
      requestId: string;
    };
