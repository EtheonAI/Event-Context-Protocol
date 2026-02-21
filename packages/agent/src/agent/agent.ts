import type {
    ActionResult,
    ContextFrame,
    EmitEventRequest,
    EnrichContextRequest,
    EnrichContextResult,
    EventIntent,
    EventUrgency,
    ExecuteActionRequest,
    ExecuteActionResult,
    ListEventTypesResult,
    RequestOptions,
    SubscribeEventsResult,
    Transport
} from '@modelcontextprotocol/core';

import type { AgentContext, AgentServerOptions } from './agentServer.js';
import { AgentServer } from './agentServer.js';

export type EventHandlerOptions = {
    urgencyFilter?: EventUrgency[];
    intentFilter?: EventIntent[];
};

export type EventHandler = (frame: ContextFrame, ctx: AgentContext) => ActionResult | Promise<ActionResult>;

interface RegisteredHandler {
    pattern: string;
    handler: EventHandler;
    options?: EventHandlerOptions;
}

/**
 * High-level ECP agent that wraps AgentServer with simplified event handler registration.
 *
 * Provides glob-pattern matching for event types and filtering by urgency/intent.
 */
export class Agent {
    public readonly server: AgentServer;
    private _handlers: RegisteredHandler[] = [];

    constructor(agentInfo: { name: string; version: string }, options?: AgentServerOptions) {
        this.server = new AgentServer(agentInfo, options);

        // Register the events/emit handler that dispatches to registered handlers
        this.server.setRequestHandler('events/emit', async (request: EmitEventRequest, ctx: AgentContext) => {
            const frame = request.params.frame;
            const matchingHandlers = this._handlers.filter(h => this._matches(h, frame));

            if (matchingHandlers.length === 0) {
                return {
                    frameId: frame.frameId,
                    status: 'deferred' as const,
                    summary: 'No matching handlers for this event'
                };
            }

            let lastResult: ActionResult = {
                frameId: frame.frameId,
                status: 'handled' as const,
                actionsTaken: [],
                summary: ''
            };

            for (const registered of matchingHandlers) {
                lastResult = await registered.handler(frame, ctx);
            }

            return lastResult;
        });
    }

    /**
     * Register an event handler for a glob pattern.
     *
     * @param pattern - Glob pattern (e.g., 'payment.*', 'email.**', '*')
     * @param handler - Handler function
     * @param options - Optional urgency/intent filters
     */
    on(pattern: string, handler: EventHandler, options?: EventHandlerOptions): void {
        this._handlers.push({ pattern, handler, options });
    }

    /**
     * Connect the agent to a transport.
     */
    async connect(transport: Transport): Promise<void> {
        await this.server.connect(transport);
    }

    /**
     * Close the agent connection.
     */
    async close(): Promise<void> {
        await this.server.close();
    }

    /**
     * Request additional context from the event source.
     */
    async requestContext(params: EnrichContextRequest['params'], options?: RequestOptions): Promise<EnrichContextResult> {
        return this.server.requestContext(params, options);
    }

    /**
     * Request the event source to execute an action.
     */
    async executeAction(params: ExecuteActionRequest['params'], options?: RequestOptions): Promise<ExecuteActionResult> {
        return this.server.executeAction(params, options);
    }

    /**
     * Subscribe to event patterns on the event source.
     */
    async subscribe(patterns: string[], options?: RequestOptions): Promise<SubscribeEventsResult> {
        return this.server.subscribe({ patterns }, options);
    }

    /**
     * List available event types from the event source.
     */
    async listEventTypes(options?: RequestOptions): Promise<ListEventTypesResult> {
        return this.server.listEventTypes(options);
    }

    private _matches(registered: RegisteredHandler, frame: ContextFrame): boolean {
        // Check glob pattern
        if (!this._matchGlob(registered.pattern, frame.eventType)) {
            return false;
        }

        // Check urgency filter
        if (
            registered.options?.urgencyFilter &&
            registered.options.urgencyFilter.length > 0 &&
            !registered.options.urgencyFilter.includes(frame.urgency)
        ) {
            return false;
        }

        // Check intent filter
        if (
            registered.options?.intentFilter &&
            registered.options.intentFilter.length > 0 &&
            !registered.options.intentFilter.includes(frame.intent)
        ) {
            return false;
        }

        return true;
    }

    /**
     * Simple glob pattern matching for event types.
     * - `*` matches a single segment (between dots)
     * - `**` matches any number of segments
     * - Exact match for literal segments
     */
    _matchGlob(pattern: string, eventType: string): boolean {
        const patternParts = pattern.split('.');
        const typeParts = eventType.split('.');

        return this._matchParts(patternParts, 0, typeParts, 0);
    }

    private _matchParts(patternParts: string[], pi: number, typeParts: string[], ti: number): boolean {
        // Both exhausted
        if (pi >= patternParts.length && ti >= typeParts.length) {
            return true;
        }

        // Pattern exhausted but type still has parts
        if (pi >= patternParts.length) {
            return false;
        }

        // Type exhausted but pattern still has parts
        if (ti >= typeParts.length) {
            // Only match if remaining pattern parts are all **
            for (let i = pi; i < patternParts.length; i++) {
                if (patternParts[i] !== '**') return false;
            }
            return true;
        }

        const p = patternParts[pi]!;

        if (p === '**') {
            // ** can match zero or more segments
            // Try matching zero segments
            if (this._matchParts(patternParts, pi + 1, typeParts, ti)) {
                return true;
            }
            // Try matching one or more segments
            return this._matchParts(patternParts, pi, typeParts, ti + 1);
        }

        if (p === '*') {
            // * matches exactly one segment
            return this._matchParts(patternParts, pi + 1, typeParts, ti + 1);
        }

        // Literal match
        if (p === typeParts[ti]) {
            return this._matchParts(patternParts, pi + 1, typeParts, ti + 1);
        }

        return false;
    }
}
