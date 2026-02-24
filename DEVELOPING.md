# Figmatron Developer Guide

Figmatron is a Figma plugin that uses the Gemini API to analyze selections, generate SVGs, answer questions about designs, and output structured diagram data.

## Architecture Overview

The plugin consists of three main parts:
1. **Figma Sandbox (`src/code.ts`)**: Runs within Figma's restricted execution environment. It has direct access to the Figma document canvas but cannot make network requests or use standard browser APIs. It communicates with the UI via `postMessage`.
2. **React UI (`src/ui/App.tsx`)**: Runs in a browser iframe. It handles the UI, manages API keys, and most importantly, proxies network requests to the Gemini API (`src/ui/agentPipeline.ts`).
3. **Shared Protocol (`src/shared/protocol.ts`)**: Type definitions for messages passed between the Figma Sandbox and the UI iframe.

## Component Flow

### 1. Context Preparation
When the user submits a prompt, `App.tsx` sends a `prepare-context` message to `code.ts`.
- `code.ts` gathers information about the current selection (bounds, counts).
- Depending on the mode, it exports an SVG string representing the selection.
- If a screenshot is needed, it exports a PNG using `exportAsync({ format: 'PNG' })`. To avoid token limits and payload size issues, it applies adaptive downscaling (trying scales 1.0, 0.75, 0.5, 0.25) to ensure the generated base64 string stays under `maxScreenshotBytes`.
- The gathered data (`ContextPacket`) is sent back to `App.tsx`.

### 2. Prompt Building and Routing
`App.tsx` delegates to `agentPipeline.ts`:
- **Routing**: `chooseRoute` decides whether the response should be plain text, SVG, or Structured JSON (diagram IR) based on the user's prompt and active mode.
- **Prompt**: `buildPromptText` and `systemPromptFor` construct the final text sent to Gemini, intelligently omitting the SVG buffer in Vectorize mode (to save context limit when only raster is required).

### 3. Model Request
`callGemini` is invoked.
- We rely on `fetch` and Google's Generative Language API.
- If the image byte size exceeds limits despite downscaling, it explicitly omits the inline data and logs a warning, or fails fast if vectorization absolutely requires it (surfacing the error to the UI).

### 4. Validation and Parsing
Depending on the route:
- **SVG Route**: `validateSvg` parses the returned string as XML, checking for missing `viewBox`, overlapping tags, and explicitly disallowed elements (`<script>`, `<foreignObject>`).
- **Diagram IR Route**: `parseDiagramIR` extracts JSON. `validateDiagramIR` checks for valid connectivity, non-overlapping nodes, and correct bounds. 

If validation fails, the pipeline may attempt an automatic repair pass (`buildRepairPrompt`) up to a specified limit.

### 5. Insertion
If valid, `App.tsx` sends an `insert-svg` message to `code.ts`. The Figma Sandbox parses the SVG and inserts it onto the canvas, returning a success or failure state.

## Testing

This project uses **Vitest** for isolated unit testing of the `agentPipeline.ts` logic.
We do not test the Figma Sandbox directly in Vitest due to the lack of DOM/Figma API mocks in Node.

To run tests:
```bash
npm install
npm run test
# or npx vitest run
```

When adding new modes, ensure you write a test covering the prompt routing and validation steps in `src/tests/pipeline.test.ts`.
