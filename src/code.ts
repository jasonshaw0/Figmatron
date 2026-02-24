import type {
  ContextPacket,
  PluginRequestMessage,
  PluginResponseMessage,
  SelectionInfo,
  SelectionMetadata
} from './shared/protocol';

figma.showUI(__html__, { width: 340, height: 800, themeColors: true });

const canceledRequests = new Set<string>();
let selectionUpdateTimer: number | undefined;

function decodeUTF8(bytes: Uint8Array): string {
  let s = '';
  let i = 0;
  while (i < bytes.length) {
    let c = bytes[i++];
    if (c > 127) {
      if (c > 191 && c < 224) {
        if (i >= bytes.length) throw new Error('UTF-8 decode: incomplete 2-byte sequence');
        c = (c & 31) << 6 | bytes[i++] & 63;
      } else if (c > 223 && c < 240) {
        if (i + 1 >= bytes.length) throw new Error('UTF-8 decode: incomplete 3-byte sequence');
        c = (c & 15) << 12 | (bytes[i++] & 63) << 6 | bytes[i++] & 63;
      } else if (c > 239 && c < 248) {
        if (i + 2 >= bytes.length) throw new Error('UTF-8 decode: incomplete 4-byte sequence');
        c = (c & 7) << 18 | (bytes[i++] & 63) << 12 | (bytes[i++] & 63) << 6 | bytes[i++] & 63;
      } else throw new Error('UTF-8 decode: unknown multibyte start 0x' + c.toString(16) + ' at index ' + (i - 1));
    }
    if (c <= 0xffff) s += String.fromCharCode(c);
    else if (c <= 0x10ffff) {
      c -= 0x10000;
      s += String.fromCharCode(c >> 10 | 0xd800) + String.fromCharCode(c & 0x3FF | 0xdc00);
    } else throw new Error('UTF-8 decode: code point 0x' + c.toString(16) + ' exceeds UTF-16 reach');
  }
  return s;
}

const postToUi = (message: PluginResponseMessage) => {
  figma.ui.postMessage(message);
};

const getPrimarySelection = () => figma.currentPage.selection[0];

const getSelectionInfo = (): SelectionInfo => {
  const selection = figma.currentPage.selection;
  const primary = selection[0];
  if (!primary) {
    return {
      count: 0,
      hasSelection: false
    };
  }

  return {
    count: selection.length,
    hasSelection: true,
    primaryId: primary.id,
    primaryName: primary.name,
    primaryType: primary.type
  };
};

const getPaintCount = (node: SceneNode, field: 'fills' | 'strokes') => {
  const source = node as unknown as Record<string, unknown>;
  const value = source[field];
  return Array.isArray(value) ? value.length : 0;
};

const toSelectionMetadata = (node: SceneNode): SelectionMetadata => ({
  id: node.id,
  name: node.name,
  type: node.type,
  width: 'width' in node ? node.width : 0,
  height: 'height' in node ? node.height : 0,
  x: 'x' in node ? node.x : 0,
  y: 'y' in node ? node.y : 0,
  rotation: 'rotation' in node ? node.rotation : 0,
  visible: node.visible,
  locked: node.locked,
  fillsCount: getPaintCount(node, 'fills'),
  strokesCount: getPaintCount(node, 'strokes')
});

const exportSvg = async (node: SceneNode): Promise<string | undefined> => {
  try {
    const bytes = await node.exportAsync({ format: 'SVG' });
    return decodeUTF8(bytes);
  } catch (error) {
    console.warn('Failed to export SVG context', error);
    return undefined;
  }
};

const exportPngBase64 = async (
  node: SceneNode,
  maxBytes: number
): Promise<{ base64?: string; error?: string }> => {
  const scales = [1, 0.75, 0.5, 0.25];
  for (const scale of scales) {
    try {
      const bytes = await node.exportAsync({
        format: 'PNG',
        constraint: { type: 'SCALE', value: scale }
      });
      const base64 = figma.base64Encode(bytes);
      const estimatedBytes = Math.floor(base64.length * 0.75);
      if (estimatedBytes <= maxBytes) {
        return { base64 };
      }
      console.log(`Screenshot at scale ${scale} was ${estimatedBytes} bytes, exceeding limit of ${maxBytes}`);
    } catch (error) {
      console.warn(`Failed to export PNG at scale ${scale}`, error);
    }
  }
  return { error: `Selection is too large (${maxBytes} bytes max). Try selecting a smaller area or reducing resolution.` };
};

const publishSelectionState = () => {
  postToUi({
    type: 'selection-state',
    selection: getSelectionInfo()
  });
};

const handlePrepareContext = async (
  message: Extract<PluginRequestMessage, { type: 'prepare-context' }>
) => {
  const context: ContextPacket = {
    selectionInfo: getSelectionInfo()
  };
  const primary = getPrimarySelection();

  if (primary) {
    context.metadata = toSelectionMetadata(primary);
    if (message.mode !== 'vectorize') {
      context.svg = await exportSvg(primary);
    }
    if (message.includeScreenshot) {
      const result = await exportPngBase64(primary, message.maxScreenshotBytes);
      context.screenshotPngBase64 = result.base64;
      context.screenshotError = result.error;
    }
  }

  if (canceledRequests.has(message.requestId)) {
    postToUi({
      type: 'request-canceled',
      requestId: message.requestId
    });
    canceledRequests.delete(message.requestId);
    return;
  }

  postToUi({
    type: 'context-ready',
    requestId: message.requestId,
    context
  });
};

const handleInsertSvg = (
  message: Extract<PluginRequestMessage, { type: 'insert-svg' }>
) => {
  if (canceledRequests.has(message.requestId)) {
    postToUi({
      type: 'request-canceled',
      requestId: message.requestId
    });
    canceledRequests.delete(message.requestId);
    return;
  }

  try {
    const node = figma.createNodeFromSvg(message.svg);
    node.setPluginData('figmatron_version', '0.03');
    node.setPluginData('figmatron_request_id', message.requestId);
    node.setPluginData('figmatron_mode', message.mode);
    node.setPluginData('figmatron_route', message.route);

    figma.currentPage.appendChild(node);
    figma.currentPage.selection = [node];
    figma.viewport.scrollAndZoomIntoView([node]);

    postToUi({
      type: 'insert-result',
      requestId: message.requestId,
      success: true
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown insertion error';
    postToUi({
      type: 'insert-result',
      requestId: message.requestId,
      success: false,
      error: errorMessage
    });
  }
};

figma.on('selectionchange', () => {
  if (selectionUpdateTimer !== undefined) {
    clearTimeout(selectionUpdateTimer);
  }

  selectionUpdateTimer = setTimeout(() => {
    publishSelectionState();
    selectionUpdateTimer = undefined;
  }, 120) as unknown as number;
});

figma.ui.onmessage = async (rawMessage: unknown) => {
  const message = rawMessage as PluginRequestMessage;
  if (!message || typeof message !== 'object' || !('type' in message)) {
    return;
  }

  if (message.type === 'prepare-context') {
    await handlePrepareContext(message);
    return;
  }

  if (message.type === 'insert-svg') {
    handleInsertSvg(message);
    return;
  }

  if (message.type === 'cancel-request') {
    canceledRequests.add(message.requestId);
    postToUi({
      type: 'request-canceled',
      requestId: message.requestId
    });
    return;
  }

  if (message.type === 'resize-ui') {
    figma.ui.resize(message.width, message.height);
  }
};

publishSelectionState();
