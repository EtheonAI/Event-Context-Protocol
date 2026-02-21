# Event Context Protocol (ECP)

**The missing protocol layer between applications and AI agents.**

ECP lets any application (Stripe, Gmail, AWS, HubSpot) push semantic, context-rich events to any AI agent — no custom integration code, no dumb webhooks, no token waste.

Built on top of [Anthropic's Model Context Protocol (MCP)](https://github.com/modelcontextprotocol/typescript-sdk), ECP reuses the same Protocol base class, Transport interface, and JSON-RPC infrastructure. MCP was built for **humans** to talk to AI via clients (IDEs, chat UIs). ECP is the same idea but for **applications** to talk to AI via events.

## Why ECP?

Traditional webhooks are dumb pipes — they send raw JSON payloads and leave all the parsing, classification, and context assembly to the consumer. This means:

- Every AI agent needs custom integration code per webhook source
- Raw payloads waste tokens — the agent receives everything, even irrelevant fields
- No semantic meaning — the agent must figure out intent, urgency, and context from scratch
- No bidirectional communication — webhooks are fire-and-forget

ECP fixes all of this:

| Traditional Webhooks | ECP |
|---------------------|-----|
| Raw JSON payload | Pre-classified **ContextFrame** with semantic labels, intent, urgency |
| Custom parsing per source | Standardized protocol — one integration handles all sources |
| All data sent upfront | Inline context + on-demand enrichment via `context/enrich` |
| Fire-and-forget | Bidirectional — agent can request context and execute actions back |
| No type safety | Full TypeScript types with Zod validation |

## How It Works

```
┌─────────────────┐                          ┌──────────────────┐
│   Event Source   │   events/emit ──────>   │   AI Agent       │
│   (Gmail, etc.)  │                          │   (Your Agent)   │
│                  │   <── context/enrich     │                  │
│                  │   <── actions/execute    │                  │
│                  │   <── events/subscribe   │                  │
│                  │   <── events/list_types  │                  │
└─────────────────┘                          └──────────────────┘
     Client role                                  Server role
     (initiates connection)                       (receives events)
```

ECP uses the same JSON-RPC wire protocol as MCP. The **EventSource** takes the client role (initiates connection), and the **AgentServer** takes the server role. Communication is **bidirectional** — the agent can send requests back to the source for context enrichment and action execution.

### The ContextFrame

The core innovation. Instead of raw webhook payloads, applications emit **ContextFrames** — semantic, pre-classified, context-rich event payloads:

```typescript
{
  frameId: string;           // Unique identifier
  source: string;            // Origin application (e.g., 'gmail', 'stripe')
  eventType: string;         // Dot-notation type (e.g., 'payment.failed')
  semanticLabel?: string;    // Human-readable classification (e.g., 'COURT_ORDER')
  intent: 'requires_action' | 'informational' | 'requires_approval' | 'context_update';
  urgency: 'critical' | 'high' | 'normal' | 'low';
  confidence: number;        // 0-1, how confident the classification is
  context?: {
    resources?: Array<{ uri: string; text?: string }>;
    variables?: Record<string, unknown>;       // Pre-extracted entities
    suggestedTools?: Array<{ name: string; reason?: string }>;
  };
  rawPayload?: unknown;      // Original webhook payload if needed
  idempotencyKey?: string;   // For deduplication
  timestamp: string;
}
```

The agent receives pre-classified data with extracted entities, suggested tools, and semantic labels. No parsing. No wasted tokens. No guessing.

### Bidirectional Communication

Unlike webhooks, ECP is bidirectional. The agent can talk back to the source:

| Method | Direction | Purpose |
|--------|-----------|---------|
| `events/emit` | Source -> Agent | Push a ContextFrame |
| `context/enrich` | Agent -> Source | Request additional data on demand |
| `actions/execute` | Agent -> Source | Execute an action on the source |
| `events/subscribe` | Agent -> Source | Subscribe to event patterns |
| `events/list_types` | Agent -> Source | Discover available event types |

This means the agent can:
1. Receive a classified email event with just the subject and sender
2. Request the full email body only if needed (`context/enrich`)
3. Draft a reply directly on Gmail (`actions/execute`)

All through one protocol. No custom API integrations.

## Packages

| Package | Description |
|---------|-------------|
| `@etheon/ecp-event-source` | What applications implement to emit events |
| `@etheon/ecp-agent` | What AI agents implement to receive and process events |

Both packages depend on `@modelcontextprotocol/core` for the protocol infrastructure.

## Quick Start

### Create an Event Source (what your app implements)

```typescript
import { EventSource } from '@etheon/ecp-event-source';

const source = new EventSource(
  { name: 'my-app', version: '1.0.0' },
  {
    capabilities: {
      eventTypes: ['order.created', 'order.failed'],
      contextEnrichment: true,   // Can provide additional context on demand
      actionExecution: true      // Can execute actions requested by the agent
    }
  }
);

// Handle context enrichment requests from the agent
source.setRequestHandler('context/enrich', async (request) => ({
  frameId: request.params.frameId,
  context: {
    variables: { orderDetails: await fetchOrder(request.params.frameId) }
  }
}));

// Handle action execution requests from the agent
source.setRequestHandler('actions/execute', async (request) => {
  if (request.params.action === 'issue_refund') {
    const refund = await processRefund(request.params.params?.orderId);
    return { success: true, result: { refundId: refund.id } };
  }
  return { success: false, error: 'Unknown action' };
});

// Connect to the agent and emit events
await source.connect(transport);

const result = await source.emit({
  frameId: 'frame-1',
  source: 'my-app',
  eventType: 'order.failed',
  semanticLabel: 'PAYMENT_DECLINED',
  intent: 'requires_action',
  urgency: 'high',
  confidence: 0.95,
  context: {
    variables: { orderId: 'ord-456', amount: 99.99, currency: 'USD' },
    suggestedTools: [{ name: 'issue_refund', reason: 'Payment was declined' }]
  },
  timestamp: new Date().toISOString()
});

console.log(result.status);      // 'handled'
console.log(result.summary);     // 'Refund issued for failed order'
```

### Create an Agent (what your AI implements)

```typescript
import { Agent } from '@etheon/ecp-agent';

const agent = new Agent(
  { name: 'order-agent', version: '1.0.0' },
  {
    capabilities: {
      eventSubscriptions: ['order.*'],
      tools: ['issue_refund', 'notify_customer']
    }
  }
);

// Register handlers with glob patterns and filters
agent.on('order.failed', async (frame) => {
  // Request more context from the source (only when needed)
  const enriched = await agent.requestContext({ frameId: frame.frameId });

  // Execute an action back on the source
  const result = await agent.executeAction({
    frameId: frame.frameId,
    action: 'issue_refund',
    params: { orderId: frame.context?.variables?.orderId }
  });

  return {
    frameId: frame.frameId,
    status: 'handled',
    actionsTaken: [{ tool: 'issue_refund', result: result.result }],
    summary: 'Refund issued for failed order'
  };
}, {
  intentFilter: ['requires_action'],        // Only actionable events
  urgencyFilter: ['high', 'critical']       // Only high/critical urgency
});

// Informational events just get logged
agent.on('order.*', async (frame) => {
  console.log(`Order event: ${frame.semanticLabel}`);
  return { frameId: frame.frameId, status: 'handled' };
}, { intentFilter: ['informational'] });

await agent.connect(transport);
```

### Glob Pattern Matching

Agent handlers use glob patterns for event type matching:

- `payment.*` — matches `payment.failed`, `payment.received` (single segment)
- `email.**` — matches `email.received`, `email.classified.spam` (any depth)
- `*` — matches any single-segment event type
- `payment.failed` — exact match

## Built on Anthropic's MCP

ECP is built directly on top of [Anthropic's Model Context Protocol](https://modelcontextprotocol.io/) TypeScript SDK. We forked the MCP repo and added ECP as new packages alongside the existing MCP infrastructure.

### What we reuse from MCP:

- **`Protocol` abstract base class** — JSON-RPC message routing, request/response correlation, capability negotiation, transport management
- **`Transport` interface** — Pluggable transport layer (HTTP, stdio, WebSocket, in-memory)
- **Zod v4 schema system** — Type-safe message validation with compile-time safety
- **Capability negotiation** — Strict capability checking between source and agent during initialization
- **`InMemoryTransport`** — For testing without network overhead

### What ECP adds:

- **New Zod schemas in `types.ts`** — `ContextFrame`, `ActionResult`, `EventSourceCapabilities`, `AgentCapabilities`, and request/result schemas for all 5 new methods
- **`EventSource` class** (`packages/event-source/`) — Extends `Protocol`, acts as client role, implements initialization handshake and event emission
- **`AgentServer` class** (`packages/agent/`) — Extends `Protocol`, acts as server role, handles incoming events and sends requests back
- **`Agent` class** (`packages/agent/`) — High-level wrapper around `AgentServer` with glob-pattern matching and urgency/intent filtering
- **Updated union types** — All existing MCP union definitions (`ClientRequestSchema`, `ServerRequestSchema`, `ResultTypeMap`, etc.) extended with ECP types
- **Updated capability schemas** — `ClientCapabilitiesSchema` gets `events` field, `ServerCapabilitiesSchema` gets `eventSubscriptions` field

No new wire protocol was invented. ECP is just new message types riding on the same JSON-RPC infrastructure.

## Running the Gmail Example

The repo includes a full Gmail simulation demonstrating the complete ECP flow:

```bash
pnpm install
npx tsx examples/ecp-gmail/src/main.ts
```

This demonstrates:
1. **Gmail source** emits pre-classified emails (COURT_ORDER, INVOICE, MARKETING, PERSONAL) with extracted entities (case numbers, invoice amounts, deadlines)
2. **Email agent** matches events by pattern (`email.classified`) and filters by intent (`requires_action` vs `informational`)
3. For **court orders**: agent enriches context (gets full email body), then drafts a reply acknowledging the court order
4. For **invoices**: agent forwards to accounting via `actions/execute`
5. For **marketing/personal**: agent logs and moves on (informational handler)

The agent never sees the full email body unless it needs it. Pre-extracted entities (case numbers, amounts, deadlines) are already in the ContextFrame. This is the token savings — the agent gets exactly what it needs.

## Development

```bash
pnpm install                                    # Install dependencies
pnpm --filter @etheon/ecp-event-source build    # Build event-source
pnpm --filter @etheon/ecp-agent build           # Build agent
pnpm --filter @etheon/ecp-event-source test     # Run event-source tests (5 tests)
pnpm --filter @etheon/ecp-agent test            # Run agent tests (13 tests)
pnpm --filter @etheon/ecp-event-source lint     # Lint event-source
pnpm --filter @etheon/ecp-agent lint            # Lint agent
```

## Project Structure

```
packages/
  core/              # MCP core (Protocol, Transport, types) — from Anthropic's MCP SDK
  event-source/      # @etheon/ecp-event-source — EventSource class
  agent/             # @etheon/ecp-agent — AgentServer + high-level Agent class
  client/            # MCP client (upstream)
  server/            # MCP server (upstream)
examples/
  ecp-gmail/         # Full Gmail simulation — source + agent demo
```

## Technical Details

### Protocol Flow

1. **EventSource** connects to **AgentServer** via transport
2. **Initialize handshake** — source sends capabilities (event types, enrichment, action execution), agent responds with its capabilities (subscription patterns, tools)
3. **Event emission** — source calls `events/emit` with a ContextFrame, agent processes it and returns an ActionResult
4. **Enrichment** (optional) — during processing, agent can call `context/enrich` back to the source to get additional data
5. **Action execution** (optional) — agent can call `actions/execute` back to the source to perform actions (draft reply, archive, forward, refund, etc.)

### Type Safety

All messages are validated with Zod v4 schemas at both ends. The TypeScript compiler enforces correct usage:

```typescript
// This is type-checked at compile time
const result = await source.emit({
  frameId: 'f1',
  source: 'gmail',
  eventType: 'email.received',
  intent: 'informational',    // Must be one of: requires_action | informational | requires_approval | context_update
  urgency: 'normal',          // Must be one of: critical | high | normal | low
  confidence: 0.95,           // Must be 0-1
  timestamp: new Date().toISOString()
});
// result is typed as ActionResult with status, actionsTaken, summary
```

### Transport Agnostic

ECP works with any MCP transport:
- **InMemoryTransport** — for testing and same-process communication
- **StreamableHTTP** — for remote connections over HTTP with SSE streaming
- **stdio** — for local process-spawned integrations
- **WebSocket** — for persistent connections

## License

MIT

## Credits

Built by [Etheon AI](https://github.com/EtheonAI) on top of [Anthropic's MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk).
