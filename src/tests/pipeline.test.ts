import { describe, it, expect } from 'vitest';
import { isStructuredTaskPrompt, validateDiagramIR, buildPromptText } from '../ui/agentPipeline';
import type { DiagramIR, ContextPacket } from '../shared/protocol';

describe('agentPipeline', () => {
  describe('isStructuredTaskPrompt', () => {
    it('detects flowchart keywords', () => {
      expect(isStructuredTaskPrompt('make a flowchart', 'create')).toBe(true);
      expect(isStructuredTaskPrompt('draw a process map', 'create')).toBe(true);
      expect(isStructuredTaskPrompt('workflow diagram', 'create')).toBe(true);
    });

    it('bypasses structured mode for detailed architecture keywords', () => {
      expect(isStructuredTaskPrompt('flowchart of a circuit', 'create')).toBe(false);
      expect(isStructuredTaskPrompt('logic gate schematic', 'create')).toBe(false);
    });

    it('returns false for ask mode', () => {
      expect(isStructuredTaskPrompt('flowchart', 'ask')).toBe(false);
    });
  });

  describe('validateDiagramIR', () => {
    it('catches overlapping nodes', () => {
      const ir: DiagramIR = {
        kind: 'diagram',
        canvas: { width: 500, height: 500, padding: 20 },
        nodes: [
          { id: '1', kind: 'block', label: 'A', x: 100, y: 100, width: 100, height: 50 },
          { id: '2', kind: 'block', label: 'B', x: 150, y: 120, width: 100, height: 50 }
        ],
        edges: []
      };
      const result = validateDiagramIR(ir);
      expect(result.errors).toContain('Nodes "1" and "2" overlap, which breaks readability.');
    });

    it('catches unconnected components', () => {
      const ir: DiagramIR = {
        kind: 'diagram',
        canvas: { width: 500, height: 500, padding: 20 },
        nodes: [
          { id: '1', kind: 'block', label: 'A', x: 10, y: 10, width: 100, height: 50 },
          { id: '2', kind: 'block', label: 'B', x: 200, y: 10, width: 100, height: 50 }
        ],
        edges: []
      };
      const result = validateDiagramIR(ir);
      expect(result.warnings.some(w => w.includes('Diagram has unconnected components'))).toBe(true);
    });

    it('validates a clean diagram successfully', () => {
      const ir: DiagramIR = {
        kind: 'diagram',
        canvas: { width: 500, height: 500, padding: 20 },
        nodes: [
          { id: '1', kind: 'block', label: 'A', x: 10, y: 10, width: 100, height: 50 },
          { id: '2', kind: 'block', label: 'B', x: 200, y: 10, width: 100, height: 50 }
        ],
        edges: [{ id: 'e1', from: '1', to: '2' }]
      };
      const result = validateDiagramIR(ir);
      expect(result.errors.length).toBe(0);
      expect(result.warnings.length).toBe(0);
    });
  });

  describe('buildPromptText', () => {
    it('omits SVG context in vectorize mode', () => {
      const context: ContextPacket = {
        selectionInfo: { count: 1, hasSelection: true },
        svg: '<svg><rect width="10" height="10"/></svg>'
      };
      const text = buildPromptText({
        userPrompt: 'Vectorize this',
        mode: 'vectorize',
        route: 'direct_svg',
        context,
        screenshotIncluded: false
      });
      expect(text).not.toContain('SELECTED_CONTEXT_SVG');
    });

    it('includes SVG context in modify mode', () => {
      const context: ContextPacket = {
        selectionInfo: { count: 1, hasSelection: true },
        svg: '<svg><rect width="10" height="10"/></svg>'
      };
      const text = buildPromptText({
        userPrompt: 'Modify this',
        mode: 'modify',
        route: 'direct_svg',
        context,
        screenshotIncluded: false
      });
      expect(text).toContain('SELECTED_CONTEXT_SVG');
    });
  });
});
