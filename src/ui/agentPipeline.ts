import type {
  ContextPacket,
  DiagramIR,
  DiagramNode,
  QueryMode,
  RouteMode,
  ValidationReport
} from '../shared/protocol';

const BASE_SVG_PROMPT = `
You are Figmatron, a Figma-native SVG generation engine.

Return valid production-safe SVG only. Follow these strict rules:
- Output a single complete SVG.
- Include viewBox on root <svg>.
- Never include scripts, foreignObject, iframe, or external references.
- Keep geometry coherent and preserve topology intent for modifications.
- Do not return partial diffs.

If context SVG is provided, preserve structure and intent while applying requested changes.
`;

const ASK_PROMPT = `
You are a design assistant inside Figma.
Provide concise, practical answers.
If context is provided, reason from that context.
Do not output SVG unless explicitly asked.
`;

const VECTORIZE_PROMPT = `
You are Figmatron, a specialized AI vectorization and optimization engine.
Your task is to analyze the provided screenshot image and recreate it faithfully as an SVG.
You must apply any of the user's specific controls and customization requests (e.g. smoothness, color mode, detail level).
Return valid production-safe SVG only. Follow these strict rules:
- Output a single complete SVG.
- Include viewBox on root <svg>.
- Never include scripts, foreignObject, or external references.
- Clean up any compression artifacts and heavily optimize paths for a clean vector look.
`;

const STRUCTURED_IR_PROMPT = `
You are generating structured diagram plans for deterministic rendering.
Return ONLY JSON matching this schema:
{
  "kind": "diagram",
  "canvas": { "width": number, "height": number, "padding": number },
  "nodes": [
    {
      "id": "string",
      "kind": "block|decision|terminator|io|gate|text",
      "label": "string",
      "x": number,
      "y": number,
      "width": number,
      "height": number
    }
  ],
  "edges": [
    {
      "id": "string",
      "from": "nodeId",
      "to": "nodeId",
      "fromSide": "top|right|bottom|left",
      "toSide": "top|right|bottom|left",
      "label": "optional string"
    }
  ],
  "styles": {
    "stroke": "hex color",
    "strokeWidth": number,
    "fill": "hex color",
    "textColor": "hex color",
    "fontSize": number
  }
}
Rules:
- Keep nodes aligned and readable.
- Use orthogonal flow where practical.
- Ensure every edge points to valid node ids.
- Never include prose or markdown.
`;

const REPAIR_PROMPT = `
You must repair invalid SVG output.
Return ONLY corrected SVG in a single fenced xml block.
Preserve original visual intent, labels, and structure.
`;

const MAX_PROMPT_SVG_CHARS = 120000;
const MAX_PROMPT_SCREENSHOT_BYTES = 300000;
const MAX_SVG_LENGTH = 400000;
const MAX_SVG_NODE_COUNT = 5000;

export const isStructuredTaskPrompt = (prompt: string, mode: QueryMode) => {
  if (mode === 'ask') {
    return false;
  }

  const normalized = prompt.toLowerCase();
  const keywords = [
    'flowchart',
    'block diagram',
    'reflow',
    'orientation',
    'rotate'
  ];
  
  // Exclude explicit requests for detailed components/symbols
  const bypassKeywords = [
    'circuit',
    'logic gate',
    'schematic',
    'schema',
    'detailed',
    'symbols'
  ];

  if (bypassKeywords.some((keyword) => normalized.includes(keyword))) {
    return false; // Prefer direct_svg for rich rendering
  }

  return keywords.some((keyword) => normalized.includes(keyword));
};

export const chooseRoute = (
  prompt: string,
  mode: QueryMode,
  routeOverride: RouteMode | 'auto'
): RouteMode => {
  if (routeOverride === 'direct_svg' || routeOverride === 'structured_ir') {
    return routeOverride;
  }
  if (mode === 'ask') {
    return 'direct_svg';
  }
  if (mode === 'vectorize') {
    return 'direct_svg';
  }
  return isStructuredTaskPrompt(prompt, mode) ? 'structured_ir' : 'direct_svg';
};

export const responseModeFor = (mode: QueryMode, route: RouteMode) => {
  if (mode === 'ask') {
    return 'text' as const;
  }
  if (route === 'structured_ir') {
    return 'ir_json' as const;
  }
  return 'svg' as const;
};

const truncate = (value: string, maxChars: number) => {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n...[TRUNCATED ${value.length - maxChars} CHARS]`;
};

export const buildPromptText = (params: {
  userPrompt: string;
  mode: QueryMode;
  route: RouteMode;
  context: ContextPacket;
  screenshotIncluded: boolean;
}) => {
  const { userPrompt, mode, route, context, screenshotIncluded } = params;
  const segments: string[] = [];

  segments.push(`MODE: ${mode.toUpperCase()}`);
  if (route === 'structured_ir') {
    segments.push('RESPONSE_FORMAT: JSON_DIAGRAM_IR');
  } else if (mode === 'ask') {
    segments.push('RESPONSE_FORMAT: TEXT');
  } else {
    segments.push('RESPONSE_FORMAT: SVG');
  }

  segments.push(`USER_PROMPT:\n${userPrompt}`);

  segments.push(
    `SELECTION_SUMMARY: ${JSON.stringify(context.selectionInfo, null, 2)}`
  );

  if (context.metadata) {
    segments.push(`PRIMARY_NODE_METADATA:\n${JSON.stringify(context.metadata, null, 2)}`);
  }

  if (context.svg) {
    segments.push(
      `SELECTED_CONTEXT_SVG:\n\`\`\`xml\n${truncate(context.svg, MAX_PROMPT_SVG_CHARS)}\n\`\`\``
    );
  }

  if (screenshotIncluded) {
    const estimatedBytes = context.screenshotPngBase64
      ? Math.floor(context.screenshotPngBase64.length * 0.75)
      : 0;
    segments.push(`SCREENSHOT_ATTACHED: ${estimatedBytes} bytes`);
  }

  return segments.join('\n\n');
};

export const systemPromptFor = (mode: QueryMode, route: RouteMode) => {
  if (mode === 'ask') {
    return ASK_PROMPT.trim();
  }
  if (mode === 'vectorize') {
    return VECTORIZE_PROMPT.trim();
  }
  if (route === 'structured_ir') {
    return STRUCTURED_IR_PROMPT.trim();
  }
  return BASE_SVG_PROMPT.trim();
};

interface GeminiCallParams {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userText: string;
  screenshotPngBase64?: string;
  signal?: AbortSignal;
}

export const callGemini = async (params: GeminiCallParams): Promise<string> => {
  const {
    apiKey,
    model,
    systemPrompt,
    userText,
    screenshotPngBase64,
    signal
  } = params;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const parts: Array<Record<string, unknown>> = [{ text: userText }];
  if (screenshotPngBase64) {
    const bytes = Math.floor(screenshotPngBase64.length * 0.75);
    if (bytes <= MAX_PROMPT_SCREENSHOT_BYTES) {
      parts.push({
        inline_data: {
          mime_type: 'image/png',
          data: screenshotPngBase64
        }
      });
    }
  }

  const payload = {
    system_instruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: [
      {
        role: 'user',
        parts
      }
    ]
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
    signal
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Model request failed: ${response.status}`);
  }

  const json = await response.json();
  const candidate = json?.candidates?.[0];
  const answer = candidate?.content?.parts
    ?.map((part: { text?: string }) => part.text || '')
    .join('\n')
    .trim();

  if (!answer) {
    const finishReason = candidate?.finishReason || 'unknown';
    throw new Error(`Model returned no text content (finishReason=${finishReason}).`);
  }
  return answer;
};

export const extractSvgFromResponse = (responseText: string): string | null => {
  const fencedMatch = responseText.match(
    /```(?:xml|svg|html)?\s*([\s\S]*?<svg[\s\S]*?<\/svg>[\s\S]*?)```/i
  );
  if (fencedMatch?.[1]) {
    const inFence = fencedMatch[1].match(/<svg[\s\S]*?<\/svg>/i);
    if (inFence?.[0]) {
      return inFence[0].trim();
    }
  }

  const rawMatch = responseText.match(/<svg[\s\S]*?<\/svg>/i);
  return rawMatch?.[0]?.trim() || null;
};

const sanitizeSvg = (svg: string) =>
  svg
    .replace(/^\uFEFF/, '')
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .trim();

export const validateSvg = (svgInput: string): ValidationReport & { svg: string } => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sanitized = sanitizeSvg(svgInput);

  if (!sanitized) {
    errors.push('SVG content is empty.');
  }

  if (sanitized.length > MAX_SVG_LENGTH) {
    warnings.push(`SVG length (${sanitized.length}) is very large.`);
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(sanitized, 'image/svg+xml');
  if (doc.querySelector('parsererror')) {
    errors.push('SVG XML parse error.');
    return {
      category: 'parse',
      errors,
      warnings,
      repairable: true,
      svg: sanitized
    };
  }

  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg') {
    errors.push('Root element must be <svg>.');
  }

  if (!root.getAttribute('viewBox')) {
    errors.push('Missing required viewBox attribute on <svg>.');
  }

  const disallowedTags = ['script', 'foreignobject', 'iframe', 'object', 'embed'];
  const badTags = disallowedTags.filter((tag) => doc.getElementsByTagName(tag).length > 0);
  if (badTags.length > 0) {
    errors.push(`Disallowed tags found: ${badTags.join(', ')}`);
  }

  const allElements = Array.from(doc.querySelectorAll('*'));
  if (allElements.length > MAX_SVG_NODE_COUNT) {
    errors.push(`SVG has too many nodes (${allElements.length}).`);
  }

  for (const element of allElements) {
    for (const attr of Array.from(element.attributes)) {
      const attrName = attr.name.toLowerCase();
      const attrValue = attr.value.toLowerCase();
      if (
        (attrName === 'href' || attrName === 'xlink:href') &&
        (attrValue.startsWith('http://') || attrValue.startsWith('https://'))
      ) {
        errors.push('External href references are not allowed.');
      }
      if (attrName.startsWith('on')) {
        errors.push(`Event attribute "${attr.name}" is not allowed.`);
      }
    }
  }

  if (!root.getAttribute('width') || !root.getAttribute('height')) {
    warnings.push('SVG width/height missing; relying on viewBox only.');
  }

  return {
    category: errors.length > 0 ? 'validation' : 'validation',
    errors,
    warnings,
    repairable: errors.length > 0,
    svg: sanitized
  };
};

export const buildRepairPrompt = (params: {
  originalPrompt: string;
  originalResponse: string;
  validationErrors: string[];
}) => {
  const { originalPrompt, originalResponse, validationErrors } = params;
  return `${REPAIR_PROMPT.trim()}

ORIGINAL_USER_PROMPT:
${originalPrompt}

VALIDATION_ERRORS:
${validationErrors.map((error, index) => `${index + 1}. ${error}`).join('\n')}

BROKEN_OUTPUT:
\`\`\`
${truncate(originalResponse, 180000)}
\`\`\``;
};

const extractJsonFromResponse = (responseText: string) => {
  const fenced = responseText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  const firstBrace = responseText.indexOf('{');
  const lastBrace = responseText.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return responseText.slice(firstBrace, lastBrace + 1).trim();
  }
  return null;
};

export const parseDiagramIR = (responseText: string): DiagramIR => {
  const jsonCandidate = extractJsonFromResponse(responseText);
  if (!jsonCandidate) {
    throw new Error('No JSON object found for structured diagram response.');
  }
  const parsed = JSON.parse(jsonCandidate) as DiagramIR;
  return parsed;
};

export const validateDiagramIR = (diagram: DiagramIR): ValidationReport => {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!diagram || diagram.kind !== 'diagram') {
    errors.push('Diagram IR kind must be "diagram".');
  }

  if (!diagram.canvas || diagram.canvas.width <= 0 || diagram.canvas.height <= 0) {
    errors.push('Diagram canvas width and height must be positive.');
  }

  if (!Array.isArray(diagram.nodes) || diagram.nodes.length === 0) {
    errors.push('Diagram must contain at least one node.');
  }

  if (!Array.isArray(diagram.edges)) {
    errors.push('Diagram edges must be an array.');
  }

  const nodeIds = new Set<string>();
  for (const node of diagram.nodes || []) {
    if (!node.id) {
      errors.push('Node is missing id.');
      continue;
    }
    if (nodeIds.has(node.id)) {
      errors.push(`Duplicate node id: ${node.id}`);
    }
    nodeIds.add(node.id);
    if (node.width <= 0 || node.height <= 0) {
      errors.push(`Node "${node.id}" has non-positive size.`);
    }
  }

  for (const edge of diagram.edges || []) {
    if (!nodeIds.has(edge.from)) {
      errors.push(`Edge "${edge.id}" references missing from-node "${edge.from}".`);
    }
    if (!nodeIds.has(edge.to)) {
      errors.push(`Edge "${edge.id}" references missing to-node "${edge.to}".`);
    }
  }

  if ((diagram.nodes || []).length > 100) {
    warnings.push('Large diagram node count may reduce readability.');
  }

  return {
    category: 'validation',
    errors,
    warnings,
    repairable: errors.length > 0
  };
};

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const sidePoint = (
  node: DiagramNode,
  side: 'top' | 'right' | 'bottom' | 'left'
) => {
  if (side === 'top') {
    return { x: node.x + node.width / 2, y: node.y };
  }
  if (side === 'right') {
    return { x: node.x + node.width, y: node.y + node.height / 2 };
  }
  if (side === 'bottom') {
    return { x: node.x + node.width / 2, y: node.y + node.height };
  }
  return { x: node.x, y: node.y + node.height / 2 };
};

const inferSide = (from: DiagramNode, to: DiagramNode): 'top' | 'right' | 'bottom' | 'left' => {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? 'right' : 'left';
  }
  return dy > 0 ? 'bottom' : 'top';
};

const nodeShape = (node: DiagramNode, stroke: string, fill: string, strokeWidth: number) => {
  if (node.kind === 'text') {
    return '';
  }
  if (node.kind === 'decision') {
    const x1 = node.x + node.width / 2;
    const y1 = node.y;
    const x2 = node.x + node.width;
    const y2 = node.y + node.height / 2;
    const x3 = node.x + node.width / 2;
    const y3 = node.y + node.height;
    const x4 = node.x;
    const y4 = node.y + node.height / 2;
    return `<path d="M ${x1} ${y1} L ${x2} ${y2} L ${x3} ${y3} L ${x4} ${y4} Z" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />`;
  }
  if (node.kind === 'terminator') {
    return `<ellipse cx="${node.x + node.width / 2}" cy="${node.y + node.height / 2}" rx="${node.width / 2}" ry="${node.height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />`;
  }
  if (node.kind === 'io') {
    const skew = Math.max(8, Math.round(node.width * 0.12));
    const points = `${node.x + skew},${node.y} ${node.x + node.width},${node.y} ${node.x + node.width - skew},${node.y + node.height} ${node.x},${node.y + node.height}`;
    return `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />`;
  }
  const radius = node.kind === 'gate' ? Math.min(18, node.height / 2) : 8;
  return `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${radius}" ry="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />`;
};

export const renderDiagramIrToSvg = (diagram: DiagramIR): string => {
  const stroke = diagram.styles?.stroke || '#1f2937';
  const fill = diagram.styles?.fill || '#ffffff';
  const textColor = diagram.styles?.textColor || '#111827';
  const strokeWidth = diagram.styles?.strokeWidth || 2;
  const fontSize = diagram.styles?.fontSize || 14;
  const padding = diagram.canvas.padding || 24;

  const nodesById = new Map(diagram.nodes.map((node) => [node.id, node]));
  const edges = diagram.edges
    .map((edge) => {
      const fromNode = nodesById.get(edge.from);
      const toNode = nodesById.get(edge.to);
      if (!fromNode || !toNode) {
        return '';
      }
      const startSide = edge.fromSide || inferSide(fromNode, toNode);
      const endSide = edge.toSide || inferSide(toNode, fromNode);
      const start = sidePoint(fromNode, startSide);
      const end = sidePoint(toNode, endSide);
      const midX = Math.round((start.x + end.x) / 2);
      const path = `M ${start.x} ${start.y} L ${midX} ${start.y} L ${midX} ${end.y} L ${end.x} ${end.y}`;
      const label = edge.label
        ? `<text x="${midX}" y="${Math.round((start.y + end.y) / 2) - 6}" text-anchor="middle" fill="${textColor}" font-size="${Math.max(fontSize - 2, 10)}">${escapeXml(edge.label)}</text>`
        : '';
      return `<path d="${path}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" />${label}`;
    })
    .join('\n');

  const nodes = diagram.nodes
    .map((node) => {
      const shape = nodeShape(node, stroke, fill, strokeWidth);
      const labelX = Math.round(node.x + node.width / 2);
      const labelY = Math.round(node.y + node.height / 2 + fontSize * 0.35);
      const text = `<text x="${labelX}" y="${labelY}" text-anchor="middle" fill="${textColor}" font-size="${fontSize}" font-family="Inter, Helvetica, Arial, sans-serif">${escapeXml(node.label)}</text>`;
      return `${shape}${text}`;
    })
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${diagram.canvas.width} ${diagram.canvas.height}" width="${diagram.canvas.width}" height="${diagram.canvas.height}">
<rect x="0" y="0" width="${diagram.canvas.width}" height="${diagram.canvas.height}" fill="white" />
<g transform="translate(${padding}, ${padding})">
${edges}
${nodes}
</g>
</svg>`;
};
