import { useEffect, useMemo, useRef, useState } from 'react';
import Settings from './Settings';
import ContextIndicator from './ContextIndicator';
import {
  buildPromptText,
  buildRepairPrompt,
  callGemini,
  chooseRoute,
  extractSvgFromResponse,
  parseDiagramIR,
  renderDiagramIrToSvg,
  responseModeFor,
  systemPromptFor,
  validateDiagramIR,
  validateSvg
} from './agentPipeline';
import {
  STAGES,
  type ContextPacket,
  type ExecutionTrace,
  type PluginRequestMessage,
  type PluginResponseMessage,
  type QueryMode,
  type RouteMode,
  type RouteOverride,
  type SelectionInfo,
  type StageName,
  type ValidationReport
} from '../shared/protocol';

type UiStage = StageName | 'idle' | 'error' | 'canceled';

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  content: string;
  kind?: 'normal' | 'error' | 'success';
}

interface ContextWaiter {
  resolve: (result: { context: ContextPacket; error?: string }) => void;
  reject: (error: Error) => void;
  timeoutId: number;
}

interface InsertWaiter {
  resolve: (result: { success: boolean; error?: string }) => void;
  reject: (error: Error) => void;
  timeoutId: number;
}

class PipelineError extends Error {
  category: ValidationReport['category'];
  report?: ValidationReport;

  constructor(
    category: ValidationReport['category'],
    message: string,
    report?: ValidationReport
  ) {
    super(message);
    this.category = category;
    this.report = report;
  }
}

const safeGetItem = (key: string, defaultValue: string) => {
  try {
    return localStorage.getItem(key) || defaultValue;
  } catch {
    return defaultValue;
  }
};

const safeGetBoolean = (key: string, defaultValue: boolean) => {
  try {
    const value = localStorage.getItem(key);
    return value === null ? defaultValue : value === 'true';
  } catch {
    return defaultValue;
  }
};

const safeGetRouteOverride = (key: string, defaultValue: RouteOverride) => {
  const value = safeGetItem(key, defaultValue);
  if (value === 'auto' || value === 'direct_svg' || value === 'structured_ir') {
    return value;
  }
  return defaultValue;
};

const safeSetItem = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore persistence failures in plugin sandbox
  }
};

const generateRequestId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const formatStage = (stage: UiStage) => stage.replace(/_/g, ' ');

const summarizeValidation = (report?: ValidationReport) => {
  if (!report || report.errors.length === 0) {
    return 'Validation: clean';
  }
  return `Validation errors: ${report.errors.join(' | ')}`;
};

const initialSelection: SelectionInfo = {
  count: 0,
  hasSelection: false
};

export default function App() {
  const [apiKey, setApiKey] = useState(() => safeGetItem('gemini-api-key', ''));
  const [model, setModel] = useState(() =>
    safeGetItem('gemini-model', 'gemini-3-flash-preview')
  );
  const [debugMode, setDebugMode] = useState(() =>
    safeGetBoolean('figmatron-debug-mode', false)
  );
  const [autoScreenshotModify, setAutoScreenshotModify] = useState(() =>
    safeGetBoolean('figmatron-auto-screenshot-modify', true)
  );
  const [screenshotForCreateAsk, setScreenshotForCreateAsk] = useState(() =>
    safeGetBoolean('figmatron-screenshot-create-ask', false)
  );
  const [routeOverride, setRouteOverride] = useState(() =>
    safeGetRouteOverride('figmatron-route-override', 'auto')
  );
  const [maxScreenshotSizeMB, setMaxScreenshotSizeMB] = useState(() => {
    const val = safeGetItem('figmatron-max-screenshot-mb', '3');
    return isNaN(Number(val)) ? 3 : Number(val);
  });

  const [mode, setMode] = useState<QueryMode>('create');
  const [vectorizeDetail, setVectorizeDetail] = useState('medium');
  const [vectorizeColor, setVectorizeColor] = useState('full_color');
  const [prompt, setPrompt] = useState('');
  const [selection, setSelection] = useState<SelectionInfo>(initialSelection);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [stage, setStage] = useState<UiStage>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [lastRoute, setLastRoute] = useState<RouteMode>('direct_svg');
  const [lastContext, setLastContext] = useState<ContextPacket | null>(null);
  const [diagnostics, setDiagnostics] = useState<ExecutionTrace[]>([]);
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [latestValidation, setLatestValidation] = useState<ValidationReport>();
  const [lastFailure, setLastFailure] = useState<{
    prompt: string;
    mode: QueryMode;
    message: string;
  } | null>(null);

  const activeRequestRef = useRef<{
    requestId: string;
    startedAt: number;
    controller: AbortController;
  } | null>(null);

  const contextWaitersRef = useRef<Map<string, ContextWaiter>>(new Map());
  const insertWaitersRef = useRef<Map<string, InsertWaiter>>(new Map());

  const screenshotEnabledForMode =
    mode === 'vectorize' ? true : mode === 'modify' ? autoScreenshotModify : screenshotForCreateAsk;

  const contextSvgChars = lastContext?.svg?.length ?? 0;

  const stageOrder = useMemo(() => [...STAGES], []);

  useEffect(() => {
    safeSetItem('gemini-api-key', apiKey);
  }, [apiKey]);

  useEffect(() => {
    safeSetItem('gemini-model', model);
  }, [model]);

  useEffect(() => {
    safeSetItem('figmatron-debug-mode', String(debugMode));
  }, [debugMode]);

  useEffect(() => {
    safeSetItem('figmatron-auto-screenshot-modify', String(autoScreenshotModify));
  }, [autoScreenshotModify]);

  useEffect(() => {
    safeSetItem('figmatron-screenshot-create-ask', String(screenshotForCreateAsk));
  }, [screenshotForCreateAsk]);

  useEffect(() => {
    safeSetItem('figmatron-route-override', routeOverride);
  }, [routeOverride]);

  useEffect(() => {
    safeSetItem('figmatron-max-screenshot-mb', String(maxScreenshotSizeMB));
  }, [maxScreenshotSizeMB]);

  useEffect(() => {
    if (!isLoading) {
      return undefined;
    }
    const intervalId = window.setInterval(() => {
      const active = activeRequestRef.current;
      if (!active) {
        return;
      }
      setElapsedMs(Math.round(performance.now() - active.startedAt));
    }, 120);
    return () => window.clearInterval(intervalId);
  }, [isLoading]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data?.pluginMessage as PluginResponseMessage | undefined;
      if (!message || typeof message !== 'object' || !('type' in message)) {
        return;
      }

      if (message.type === 'selection-state') {
        setSelection(message.selection);
        return;
      }

      if (message.type === 'context-ready') {
        const waiter = contextWaitersRef.current.get(message.requestId);
        if (!waiter) {
          return;
        }
        window.clearTimeout(waiter.timeoutId);
        contextWaitersRef.current.delete(message.requestId);
        waiter.resolve({ context: message.context, error: message.error });
        return;
      }

      if (message.type === 'insert-result') {
        const waiter = insertWaitersRef.current.get(message.requestId);
        if (!waiter) {
          return;
        }
        window.clearTimeout(waiter.timeoutId);
        insertWaitersRef.current.delete(message.requestId);
        waiter.resolve({ success: message.success, error: message.error });
        return;
      }

      if (message.type === 'request-canceled') {
        const contextWaiter = contextWaitersRef.current.get(message.requestId);
        if (contextWaiter) {
          window.clearTimeout(contextWaiter.timeoutId);
          contextWaitersRef.current.delete(message.requestId);
          contextWaiter.reject(new PipelineError('canceled', 'Request was canceled.'));
        }

        const insertWaiter = insertWaitersRef.current.get(message.requestId);
        if (insertWaiter) {
          window.clearTimeout(insertWaiter.timeoutId);
          insertWaitersRef.current.delete(message.requestId);
          insertWaiter.reject(new PipelineError('canceled', 'Request was canceled.'));
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const postToPlugin = (message: PluginRequestMessage) => {
    parent.postMessage({ pluginMessage: message }, '*');
  };

  const appendStatus = (entry: string) => {
    setStatusLog((prev) => [entry, ...prev].slice(0, 24));
  };

  const requestContext = (
    requestId: string,
    queryMode: QueryMode,
    includeScreenshot: boolean,
    maxScreenshotBytes: number
  ) =>
    new Promise<{ context: ContextPacket; error?: string }>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        contextWaitersRef.current.delete(requestId);
        reject(new PipelineError('model', 'Context request timed out.'));
      }, 20000);

      contextWaitersRef.current.set(requestId, {
        resolve,
        reject,
        timeoutId
      });

      postToPlugin({
        type: 'prepare-context',
        requestId,
        mode: queryMode,
        includeScreenshot,
        maxScreenshotBytes
      });
    });

  const requestInsertion = (
    requestId: string,
    svg: string,
    queryMode: QueryMode,
    route: RouteMode
  ) =>
    new Promise<{ success: boolean; error?: string }>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        insertWaitersRef.current.delete(requestId);
        reject(new PipelineError('insert', 'Insertion timed out.'));
      }, 10000);

      insertWaitersRef.current.set(requestId, {
        resolve,
        reject,
        timeoutId
      });

      postToPlugin({
        type: 'insert-svg',
        requestId,
        svg,
        mode: queryMode,
        route
      });
    });

  const cancelActiveRequest = () => {
    const active = activeRequestRef.current;
    if (!active) {
      return;
    }
    active.controller.abort();
    postToPlugin({
      type: 'cancel-request',
      requestId: active.requestId
    });
    appendStatus(`[${active.requestId}] canceled by user`);
    setStage('canceled');
  };

  const copyLatestDiagnostics = async () => {
    const latest = diagnostics[0];
    if (!latest) {
      return;
    }
    const output = JSON.stringify(latest, null, 2);
    try {
      await navigator.clipboard.writeText(output);
      appendStatus('Copied diagnostics to clipboard');
    } catch {
      appendStatus('Failed to copy diagnostics to clipboard');
    }
  };

  const runQuery = async (
    queryPrompt: string,
    queryMode: QueryMode,
    forceRepair: boolean
  ) => {
    if (!apiKey.trim()) {
      alert('Please enter your Gemini API key in Settings.');
      return;
    }
    if (activeRequestRef.current) {
      return;
    }

    const requestId = generateRequestId();
    const route = chooseRoute(queryPrompt, queryMode, routeOverride);
    const responseMode = responseModeFor(queryMode, route);
    const startedAt = performance.now();
    const controller = new AbortController();
    activeRequestRef.current = { requestId, startedAt, controller };
    setIsLoading(true);
    setElapsedMs(0);
    setStage('prepare_context');
    setLastRoute(route);
    setLatestValidation(undefined);
    setLastFailure(null);

    const trace: ExecutionTrace = {
      requestId,
      mode: queryMode,
      route,
      responseMode,
      model,
      startedAt,
      stageTimingsMs: {},
      payloadSizes: {
        promptChars: 0,
        contextSvgChars: 0,
        screenshotBytes: 0,
        responseChars: 0
      },
      contextSummary: {
        selectionCount: 0,
        hasSvg: false,
        hasScreenshot: false
      }
    };

    let currentStage: StageName | null = null;
    let currentStageStart = 0;

    const enterStage = (nextStage: StageName) => {
      if (currentStage) {
        trace.stageTimingsMs[currentStage] = Math.round(
          performance.now() - currentStageStart
        );
      }
      currentStage = nextStage;
      currentStageStart = performance.now();
      setStage(nextStage);
      appendStatus(`[${requestId}] ${nextStage}`);
    };

    const closeStage = () => {
      if (!currentStage) {
        return;
      }
      trace.stageTimingsMs[currentStage] = Math.round(
        performance.now() - currentStageStart
      );
      currentStage = null;
    };

    try {
      const includeScreenshot =
        queryMode === 'vectorize' ? true : queryMode === 'modify' ? autoScreenshotModify : screenshotForCreateAsk;

      enterStage('prepare_context');
      const maxScreenshotBytes = maxScreenshotSizeMB * 1024 * 1024;
      const contextResult = await requestContext(requestId, queryMode, includeScreenshot, maxScreenshotBytes);
      const context = contextResult.context;
      setLastContext(context);
      trace.contextSummary.selectionCount = context.selectionInfo.count;
      trace.contextSummary.hasSvg = Boolean(context.svg);
      trace.contextSummary.hasScreenshot = Boolean(context.screenshotPngBase64);
      trace.payloadSizes.contextSvgChars = context.svg?.length ?? 0;
      trace.payloadSizes.screenshotBytes = context.screenshotPngBase64
        ? Math.floor(context.screenshotPngBase64.length * 0.75)
        : 0;
      closeStage();

      if (context.screenshotError) {
        if (queryMode === 'vectorize') {
          throw new PipelineError('model', context.screenshotError);
        }
        appendStatus(`Warning: ${context.screenshotError}`);
      }

      enterStage('route');
      const systemPrompt = systemPromptFor(queryMode, route);
      const userPrompt = buildPromptText({
        userPrompt: queryPrompt,
        mode: queryMode,
        route,
        context,
        screenshotIncluded: includeScreenshot
      });
      trace.payloadSizes.promptChars = userPrompt.length;
      closeStage();

      enterStage('model_call');
      const initialResponse = await callGemini({
        apiKey,
        model,
        systemPrompt,
        userText: userPrompt,
        screenshotPngBase64: includeScreenshot ? context.screenshotPngBase64 : undefined,
        maxScreenshotBytes,
        signal: controller.signal
      });
      trace.payloadSizes.responseChars = initialResponse.length;
      trace.responsePreview = initialResponse.slice(0, 2000);
      closeStage();

      let responseText = initialResponse;
      let repaired = false;
      let validationReport: (ValidationReport & { svg?: string }) | undefined;

      if (responseMode === 'text') {
        enterStage('parse');
        closeStage();
        enterStage('validate');
        closeStage();
        enterStage('insert_or_return');
        setMessages((prev) => [
          ...prev,
          {
            id: `${requestId}-model`,
            role: 'model',
            content: responseText,
            kind: 'normal'
          }
        ]);
        closeStage();
      } else if (responseMode === 'ir_json') {
        enterStage('parse');
        const diagram = parseDiagramIR(responseText);
        closeStage();

        enterStage('validate');
        const diagramValidation = validateDiagramIR(diagram);
        if (diagramValidation.errors.length > 0) {
          throw new PipelineError(
            'validation',
            `Invalid structured diagram output: ${diagramValidation.errors.join(' | ')}`,
            diagramValidation
          );
        }
        closeStage();

        enterStage('insert_or_return');
        const renderedSvg = renderDiagramIrToSvg(diagram);
        const svgValidation = validateSvg(renderedSvg);
        validationReport = svgValidation;
        if (svgValidation.errors.length > 0) {
          throw new PipelineError(
            'validation',
            `Structured SVG invalid: ${svgValidation.errors.join(' | ')}`,
            svgValidation
          );
        }
        const insertResult = await requestInsertion(
          requestId,
          svgValidation.svg,
          queryMode,
          route
        );
        if (!insertResult.success) {
          throw new PipelineError(
            'insert',
            insertResult.error || 'Unknown insertion failure.'
          );
        }
        setMessages((prev) => [
          ...prev,
          {
            id: `${requestId}-model`,
            role: 'model',
            content: 'Structured diagram rendered and inserted via deterministic pipeline.',
            kind: 'success'
          }
        ]);
        closeStage();
      } else {
        enterStage('parse');
        let svg = extractSvgFromResponse(responseText);
        if (!svg) {
          throw new PipelineError(
            'parse',
            'No <svg> element was found in the model response.'
          );
        }
        closeStage();

        enterStage('validate');
        validationReport = validateSvg(svg);
        closeStage();

        if ((forceRepair || validationReport.errors.length > 0) && validationReport.repairable) {
          enterStage('repair_if_needed');
          const repairResponse = await callGemini({
            apiKey,
            model,
            systemPrompt,
            userText: buildRepairPrompt({
              originalPrompt: queryPrompt,
              originalResponse: responseText,
              validationErrors: validationReport.errors.length > 0
                ? validationReport.errors
                : ['Manual repair requested by user.']
            }),
            signal: controller.signal
          });
          responseText = repairResponse;
          trace.payloadSizes.responseChars += repairResponse.length;
          trace.responsePreview = repairResponse.slice(0, 2000);
          repaired = true;
          closeStage();

          enterStage('parse');
          svg = extractSvgFromResponse(repairResponse);
          if (!svg) {
            throw new PipelineError(
              'parse',
              'Repair response did not include a valid <svg> block.'
            );
          }
          closeStage();

          enterStage('validate');
          validationReport = validateSvg(svg);
          closeStage();
        }

        setLatestValidation(validationReport);
        if (validationReport.errors.length > 0) {
          throw new PipelineError(
            'validation',
            validationReport.errors.join(' | '),
            validationReport
          );
        }

        enterStage('insert_or_return');
        const insertResult = await requestInsertion(
          requestId,
          validationReport.svg || '',
          queryMode,
          route
        );
        if (!insertResult.success) {
          throw new PipelineError(
            'insert',
            insertResult.error || 'Unknown insertion failure.'
          );
        }

        setMessages((prev) => [
          ...prev,
          {
            id: `${requestId}-model`,
            role: 'model',
            content: repaired
              ? 'Inserted SVG after one automatic repair pass.'
              : 'Inserted SVG successfully.',
            kind: repaired ? 'success' : 'normal'
          }
        ]);
        closeStage();
        trace.repaired = repaired;
      }

      trace.validation = validationReport;
      trace.outcome = 'success';
      setStage('done');
      setLastFailure(null);
    } catch (error) {
      const normalizedError =
        error instanceof PipelineError
          ? error
          : error instanceof DOMException && error.name === 'AbortError'
            ? new PipelineError('canceled', 'Request canceled.')
            : new PipelineError(
              'model',
              error instanceof Error ? error.message : 'Unknown pipeline failure.'
            );

      trace.validation = normalizedError.report;
      trace.errorMessage = normalizedError.message;
      trace.outcome = normalizedError.category === 'canceled' ? 'canceled' : 'failed';
      setLatestValidation(normalizedError.report);
      setStage(normalizedError.category === 'canceled' ? 'canceled' : 'error');

      const failureMessage = `Error (${normalizedError.category}): ${normalizedError.message}`;
      setMessages((prev) => [
        ...prev,
        {
          id: `${requestId}-error`,
          role: 'model',
          content: failureMessage,
          kind: 'error'
        }
      ]);

      if (normalizedError.category !== 'canceled') {
        setLastFailure({
          prompt: queryPrompt,
          mode: queryMode,
          message: failureMessage
        });
      }
    } finally {
      closeStage();
      trace.endedAt = performance.now();
      trace.totalMs = Math.round(trace.endedAt - trace.startedAt);
      setDiagnostics((prev) => [trace, ...prev].slice(0, 12));
      setElapsedMs(trace.totalMs ?? 0);
      setIsLoading(false);
      activeRequestRef.current = null;
    }
  };

  const submitPrompt = (forceRepair = false) => {
    let trimmedPrompt = prompt.trim();
    if (mode === 'vectorize' && !trimmedPrompt && selection.hasSelection) {
      trimmedPrompt = 'Vectorize this image perfectly.';
    }
    if (!trimmedPrompt || isLoading) {
      return;
    }

    let finalPrompt = trimmedPrompt;
    if (mode === 'vectorize') {
      finalPrompt += ` [CONTROLS -> Detail Level: ${vectorizeDetail.toUpperCase()}, Color Mode: ${vectorizeColor.replace('_', ' ').toUpperCase()}]`;
    }

    setMessages((prev) => [
      ...prev,
      {
        id: `${Date.now()}-user`,
        role: 'user',
        content: `[${mode.toUpperCase()}] ${trimmedPrompt}`
      }
    ]);
    setPrompt('');
    runQuery(finalPrompt, mode, forceRepair);
  };

  const retryFailure = (forceRepair: boolean) => {
    if (!lastFailure || isLoading) {
      return;
    }
    setMessages((prev) => [
      ...prev,
      {
        id: `${Date.now()}-retry`,
        role: 'user',
        content: forceRepair
          ? `[${lastFailure.mode.toUpperCase()}] Retry with repair: ${lastFailure.prompt}`
          : `[${lastFailure.mode.toUpperCase()}] Retry: ${lastFailure.prompt}`
      }
    ]);
    runQuery(lastFailure.prompt, lastFailure.mode, forceRepair);
  };

  const stageIndex =
    stage === 'idle' || stage === 'error' || stage === 'canceled'
      ? -1
      : stageOrder.indexOf(stage);

  return (
    <div className="container bg-primary text-primary" style={{ position: 'relative' }}>
      <Settings
        apiKey={apiKey}
        setApiKey={setApiKey}
        model={model}
        setModel={setModel}
        debugMode={debugMode}
        setDebugMode={setDebugMode}
        autoScreenshotModify={autoScreenshotModify}
        setAutoScreenshotModify={setAutoScreenshotModify}
        screenshotForCreateAsk={screenshotForCreateAsk}
        setScreenshotForCreateAsk={setScreenshotForCreateAsk}
        routeOverride={routeOverride}
        setRouteOverride={setRouteOverride}
        maxScreenshotSizeMB={maxScreenshotSizeMB}
        setMaxScreenshotSizeMB={setMaxScreenshotSizeMB}
      />

      <h1 className="text-brand" style={{ marginTop: 0, fontSize: '1.25rem' }}>
        Figmatron v0.03
      </h1>

      <div className="mode-toggle" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        {(['create', 'modify', 'ask', 'vectorize'] as QueryMode[]).map((item) => (
          <button
            key={item}
            className={`button mode-button ${mode === item ? 'mode-active' : ''}`}
            onClick={() => setMode(item)}
            disabled={isLoading}
          >
            {item}
          </button>
        ))}
      </div>

      {mode === 'vectorize' && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <select
            className="input"
            value={vectorizeDetail}
            onChange={e => setVectorizeDetail(e.target.value)}
            style={{ flex: 1 }}
          >
            <option value="low">Low Detail</option>
            <option value="medium">Medium Detail</option>
            <option value="high">High Detail</option>
          </select>
          <select
            className="input"
            value={vectorizeColor}
            onChange={e => setVectorizeColor(e.target.value)}
            style={{ flex: 1 }}
          >
            <option value="full_color">Full Color</option>
            <option value="grayscale">Grayscale</option>
            <option value="monochrome">Monochrome</option>
          </select>
        </div>
      )}

      <ContextIndicator
        selection={selection}
        contextSvgChars={contextSvgChars}
        screenshotEnabled={screenshotEnabledForMode}
      />

      <div className="status-block">
        <div className="stage-row">
          {stageOrder.map((item, index) => {
            const completed = stageIndex >= index;
            const active = stage === item;
            return (
              <span
                key={item}
                className={`stage-chip ${completed ? 'stage-complete' : ''} ${active ? 'stage-active' : ''}`}
              >
                {formatStage(item)}
              </span>
            );
          })}
        </div>
        <div className="status-meta">
          <span>
            Stage: {formatStage(stage)} | elapsed: {elapsedMs}ms | route: {lastRoute}
          </span>
        </div>
        {latestValidation && (
          <div className="status-meta" style={{ marginTop: 4 }}>
            <span>{summarizeValidation(latestValidation)}</span>
          </div>
        )}
      </div>

      <div className="chat-log" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {messages.length === 0 && (
          <p style={{ opacity: 0.7, fontSize: '0.875rem', margin: 0 }}>
            Ready. Choose mode, describe your task, then submit.
          </p>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`chat-bubble ${message.role === 'user' ? 'chat-user' : ''} ${message.kind === 'error' ? 'chat-error' : ''
              } ${message.kind === 'success' ? 'chat-success' : ''}`}
          >
            {message.content}
          </div>
        ))}
        {isLoading && (
          <div className="chat-bubble">
            Running {formatStage(stage)}...
          </div>
        )}
      </div>

      {lastFailure && !isLoading && (
        <div className="retry-bar">
          <span>{lastFailure.message}</span>
          <button className="button" onClick={() => retryFailure(false)}>
            Retry
          </button>
          <button className="button" onClick={() => retryFailure(true)}>
            Retry with repair
          </button>
          <button className="button" onClick={copyLatestDiagnostics}>
            Copy diagnostics
          </button>
        </div>
      )}

      <div className="input-area">
        <input
          type="text"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              submitPrompt(false);
            }
          }}
          placeholder={
            mode === 'ask'
              ? 'Ask about the selected design...'
              : mode === 'modify'
                ? 'Modify selected graphic...'
                : 'Generate a new graphic...'
          }
          className="input"
          disabled={isLoading}
        />
        <button
          onClick={() => submitPrompt(false)}
          className="bg-brand button"
          disabled={isLoading}
          style={{ opacity: isLoading ? 0.7 : 1 }}
        >
          Submit
        </button>
        {isLoading && (
          <button onClick={cancelActiveRequest} className="button" style={{ opacity: 0.9 }}>
            Cancel
          </button>
        )}
      </div>

      {debugMode && (
        <details className="debug-panel">
          <summary>Debug Panel</summary>
          <div className="debug-section">
            <strong>Latest Trace</strong>
            {diagnostics[0] ? (
              <>
                <table style={{ width: '100%', fontSize: '0.75rem', marginTop: '4px', borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr><td><b>Mode</b></td><td style={{ textAlign: 'right' }}>{diagnostics[0].mode}</td></tr>
                    <tr><td><b>Route</b></td><td style={{ textAlign: 'right' }}>{diagnostics[0].route}</td></tr>
                    <tr><td><b>Time</b></td><td style={{ textAlign: 'right' }}>{diagnostics[0].totalMs} ms</td></tr>
                    <tr><td><b>Prompt Size</b></td><td style={{ textAlign: 'right' }}>{diagnostics[0].payloadSizes.promptChars} chars</td></tr>
                    <tr><td><b>SVG Size</b></td><td style={{ textAlign: 'right' }}>{diagnostics[0].payloadSizes.contextSvgChars} chars</td></tr>
                    <tr><td><b>PNG Size</b></td><td style={{ textAlign: 'right' }}>{diagnostics[0].payloadSizes.screenshotBytes} bytes</td></tr>
                    <tr><td><b>Outcome</b></td><td style={{ textAlign: 'right' }}>{diagnostics[0].outcome}</td></tr>
                  </tbody>
                </table>
                <button className="button" onClick={copyLatestDiagnostics} style={{ marginTop: '8px', width: '100%' }}>Copy Full JSON</button>
              </>
            ) : (
              <pre>No trace yet.</pre>
            )}
          </div>
          <div className="debug-section">
            <strong>Context Preview</strong>
            <pre>{JSON.stringify(lastContext?.metadata || null, null, 2)}</pre>
            <pre>{(lastContext?.svg || '').slice(0, 1800) || '(no svg context)'}</pre>
          </div>
          <div className="debug-section">
            <strong>Status Log</strong>
            <pre>{statusLog.join('\n')}</pre>
          </div>
        </details>
      )}
    </div>
  );
}
