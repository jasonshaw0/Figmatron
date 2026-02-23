import { useState, useEffect } from 'react';
import Settings from './Settings';
import ContextIndicator from './ContextIndicator';

const SYSTEM_PROMPT = `
You are a Figma-native design and development agent operating exclusively inside Figma Design Mode.

You assist the user by generating, editing, and reasoning about vector graphics and layout elements using structured, production-quality outputs.

PRIMARY CAPABILITIES
• Generate new vector graphics (SVG only).
• Modify existing selected nodes using provided context.
• Provide design reasoning, variants, and rapid iteration support.
• Maintain visual consistency with the current document.

OPERATING RULES

1. CONTEXT-FIRST BEHAVIOR
If selection/context data is provided, treat it as the source of truth.
All outputs must align with:
– geometry
– style tokens (fills, strokes, radii)
– scale and layout intent
– visual language already present

Do not invent unrelated styles when context exists.

2. SVG GENERATION CONTRACT
When creating graphics:
– Output ONLY valid SVG.
– SVG must be clean, minimal, and production-safe.
– No metadata, comments, editor tags, or unnecessary groups.
– Use absolute values (no transforms unless required).
– Prefer paths over primitives when precision matters.
– No embedded raster images.
– No external references.
– ViewBox must be present.
– Output must be directly insertable into Figma.

Always return SVG inside a single fenced block:

\`\`\`xml
<svg ...>...</svg>
\`\`\`

Do not add explanations unless explicitly requested.

3. MODIFICATION WORKFLOW
When editing an existing graphic:
a. Briefly state the intended change in one sentence.
b. Output the fully updated SVG (never partial diffs).
c. Preserve unchanged structure when possible.

4. DESIGN INTELLIGENCE
Favor:
– geometric clarity
– consistent stroke weights
– balanced optical spacing
– minimal node count
– scalability across sizes

Avoid:
– unnecessary complexity
– decorative noise
– non-editable constructs

5. RESPONSE DISCIPLINE
Never output prose + SVG mixed together unless asked.
Never output multiple SVG options unless explicitly requested.
Never describe how to draw — just produce the result.

6. WHEN INFORMATION IS AMBIGUOUS
Make the most contextually consistent assumption and proceed.
Do not ask clarifying questions unless the task is impossible.


7. TEXT RESPONSE TRIGGER
When a message begins with "QUERY_TYPE=TEXT:", handle the input as a question or statement, not a request for a new graphic or modification to an existing one, and respond with text output. Most commonly this query type will be a question about the current document or a request for design ideas, and the user context (like with modification requests) might be provided, but will not be required.

MISSION
Act as a fast, precise vector tool — not a chat assistant.
Generate results that can be dropped into a professional design system without cleanup.
`;

const safeGetItem = (key: string, defaultVal: string) => {
  try { return localStorage.getItem(key) || defaultVal; } catch { return defaultVal; }
};
const safeSetItem = (key: string, val: string) => {
  try { localStorage.setItem(key, val); } catch {}
};

export default function App() {
  const [apiKey, setApiKey] = useState(() => safeGetItem('gemini-api-key', ''));
  const [model, setModel] = useState(() => safeGetItem('gemini-model', 'gemini-3-flash-preview'));
  
  const [prompt, setPrompt] = useState('');
  const [selectionCount, setSelectionCount] = useState(0);
  const [messages, setMessages] = useState<{role: 'user' | 'model', content: string}[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Save to local storage on change for dev convenience
  useEffect(() => { safeSetItem('gemini-api-key', apiKey); }, [apiKey]);
  useEffect(() => { safeSetItem('gemini-model', model); }, [model]);

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      const msg = event.data.pluginMessage;
      if (!msg) return;

      if (msg.type === 'selection-change') {
        setSelectionCount(msg.count);
      } else if (msg.type === 'context-response') {
        // We received context, now we call API
        await executeGeminiCall(msg.prompt, msg.svgContext);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, model]); 

  const extractSvgAndSendToFigma = (text: string) => {
    const match = text.match(/```(?:xml|svg|html)?\n?\s*(<svg[\s\S]*?<\/svg>)\s*```/i);
    const rawMatch = text.match(/(<svg[\s\S]*?<\/svg>)/i);
    
    let svgString = null;
    if (match && match[1]) {
       svgString = match[1];
    } else if (rawMatch && rawMatch[1]) {
       svgString = rawMatch[1];
    }
    
    if (svgString) {
      parent.postMessage({ pluginMessage: { type: 'create-svg', svg: svgString.trim() } }, '*');
    }
  };

  const executeGeminiCall = async (userPrompt: string, svgContext: string) => {
    if (!apiKey) {
      alert("Please enter your Gemini API Key in the settings.");
      setIsLoading(false);
      return;
    }

    setMessages(prev => [...prev, { role: 'user', content: userPrompt }]);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
    let contentText = userPrompt;
    if (svgContext) {
      contentText += `\n\n--- SELECTED CONTEXT SVG ---\n\`\`\`xml\n${svgContext}\n\`\`\``;
    }

    try {
      const payload = {
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [ { role: 'user', parts: [{ text: contentText }] } ]
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
         const errorText = await res.text();
         throw new Error(errorText);
      }

      const data = await res.json();
      const answer = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response received.";
      
      setMessages(prev => [...prev, { role: 'model', content: answer }]);
      extractSvgAndSendToFigma(answer);
    } catch (err: any) {
      console.error(err);
      setMessages(prev => [...prev, { role: 'model', content: `Error: ${err.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerate = () => {
    if (!prompt.trim() || isLoading) return;
    setIsLoading(true);
    
    // Request context from Figma sandbox first
    parent.postMessage({ pluginMessage: { type: 'request-context', prompt: prompt.trim() } }, '*');
    setPrompt("");
  };

  return (
    <div className="container bg-primary text-primary" style={{ position: 'relative' }}>
      <Settings apiKey={apiKey} setApiKey={setApiKey} model={model} setModel={setModel} />
      
      <h1 className="text-brand" style={{marginTop: 0, fontSize: '1.25rem'}}>Gemini AI</h1>
      <ContextIndicator selectionCount={selectionCount} />

      <div className="chat-log" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {messages.length === 0 && (
          <p style={{opacity: 0.7, fontSize: '0.875rem', margin: 0}}>Ready. Describe what you'd like to create or modify.</p>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{ 
            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
            backgroundColor: msg.role === 'user' ? 'var(--figma-color-bg-brand-tertiary, #e5f4ff)' : 'var(--figma-color-bg-secondary)',
            color: msg.role === 'user' ? 'var(--figma-color-text-brand)' : 'var(--figma-color-text)',
            padding: '8px 12px',
            borderRadius: '8px',
            maxWidth: '90%',
            fontSize: '0.875rem',
            whiteSpace: 'pre-wrap'
          }}>
            {msg.content}
          </div>
        ))}
        {isLoading && (
          <div style={{ alignSelf: 'flex-start', fontSize: '0.875rem', padding: '8px 12px', opacity: 0.7 }}>Thinking...</div>
        )}
      </div>

      <div className="input-area">
         <input 
           type="text" 
           value={prompt}
           onChange={e => setPrompt(e.target.value)}
           onKeyDown={e => e.key === 'Enter' && handleGenerate()}
           placeholder={selectionCount > 0 ? "Modify selection..." : "Generate an icon..."}
           className="input"
           disabled={isLoading}
         />
         <button onClick={handleGenerate} className="bg-brand button" disabled={isLoading} style={{ opacity: isLoading ? 0.7 : 1 }}>
           Submit
         </button>
      </div>
    </div>
  );
}
