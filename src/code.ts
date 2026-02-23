figma.showUI(__html__, { width: 340, height: 500, themeColors: true });

figma.on('selectionchange', () => {
  figma.ui.postMessage({
    type: 'selection-change',
    count: figma.currentPage.selection.length
  });
});

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'request-context') {
    const selection = figma.currentPage.selection;
    let svgContext = '';
    
    if (selection.length > 0) {
      try {
        const bytes = await selection[0].exportAsync({ format: 'SVG' });
        // figma exportAsync returns Uint8Array, convert to string
        svgContext = String.fromCharCode.apply(null, Array.from(bytes));
      } catch (e) {
        console.warn("Failed to export SVG context", e);
      }
    }
    
    figma.ui.postMessage({
      type: 'context-response',
      prompt: msg.prompt,
      svgContext
    });
  } else if (msg.type === 'create-svg') {
    const node = figma.createNodeFromSvg(msg.svg);
    figma.currentPage.appendChild(node);
    figma.currentPage.selection = [node];
    figma.viewport.scrollAndZoomIntoView([node]);
  } else if (msg.type === 'resize') {
     figma.ui.resize(msg.width, msg.height);
  }
};
