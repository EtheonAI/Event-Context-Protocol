import type {
    AgentCapabilities,
    BaseContext,
    ClientCapabilities,
    EnrichContextRequest,
    EnrichContextResult,
    EventSourceCapabilities,
    ExecuteActionRequest,
    ExecuteActionResult,
    Implementation,
    InitializeRequest,
    InitializeResult,
    ListEventTypesResult,
    LoggingLevel,
    MessageExtraInfo,
    NotificationMethod,
    ProtocolOptions,
    RequestMethod,
    RequestOptions,
    RequestTypeMap,
    ResultTypeMap,
    ServerCapabilities,
    SubscribeEventsRequest,
    SubscribeEventsResult
} from '@modelcontextprotocol/core';
import {
    EmptyResultSchema,
    EnrichContextResultSchema,
    ExecuteActionResultSchema,
    LATEST_PROTOCOL_VERSION,
    ListEventTypesResultSchema,
    Protocol,
    SdkError,
    SdkErrorCode,
    SubscribeEventsResultSchema
} from '@modelcontextprotocol/core';

/**
 * Context provided to agent-side request handlers.
 */
export type AgentContext = BaseContext & {
    mcpReq: {
        log: (level: LoggingLevel, data: unknown, logger?: string) => Promise<void>;
    };
};

export type AgentServerOptions = ProtocolOptions & {
    capabilities?: AgentCapabilities;
};

/**
 * Low-level ECP agent server on top of a pluggable transport.
 *
 * The agent server acts as the server role (receives connections from event sources).
 * It handles incoming events and can send requests back to the event source
 * (enrich, execute, subscribe, list_types).
 */
export class AgentServer extends Protocol<AgentContext> {
    private _eventSourceCapabilities?: EventSourceCapabilities;
    private _clientCapabilities?: ClientCapabilities;
    private _eventSourceVersion?: Implementation;
    private _capabilities: AgentCapabilities;
    private _serverCapabilities: ServerCapabilities;

    oninitialized?: () => void;

    constructor(
        private _agentInfo: Implementation,
        options?: AgentServerOptions
    ) {
        super(options);
        this._capabilities = options?.capabilities ?? {};
        this._serverCapabilities = {
            eventSubscriptions: this._capabilities
        };

        this.setRequestHandler('initialize', request => this._oninitialize(request));
        this.setNotificationHandler('notifications/initialized', () => this.oninitialized?.());
    }

    protected override buildContext(ctx: BaseContext, _transportInfo?: MessageExtraInfo): AgentContext {
        return {
            ...ctx,
            mcpReq: {
                ...ctx.mcpReq,
                log: async (_level: LoggingLevel, _data: unknown, _logger?: string) => {
                    // No-op logging for now; could be extended
                }
            }
        };
    }

    private async _oninitialize(request: InitializeRequest): Promise<InitializeResult> {
        const requestedVersion = request.params.protocolVersion;

        this._clientCapabilities = request.params.capabilities;
        this._eventSourceCapabilities = request.params.capabilities.events;
        this._eventSourceVersion = request.params.clientInfo;

        const protocolVersion = this._supportedProtocolVersions.includes(requestedVersion)
            ? requestedVersion
            : (this._supportedProtocolVersions[0] ?? LATEST_PROTOCOL_VERSION);

        return {
            protocolVersion,
            capabilities: this._serverCapabilities,
            serverInfo: this._agentInfo
        };
    }

    /**
     * After initialization, get the event source's capabilities.
     */
    getEventSourceCapabilities(): EventSourceCapabilities | undefined {
        return this._eventSourceCapabilities;
    }

    /**
     * After initialization, get the event source's version info.
     */
    getEventSourceVersion(): Implementation | undefined {
        return this._eventSourceVersion;
    }

    /**
     * Returns the current server capabilities.
     */
    public getCapabilities(): ServerCapabilities {
        return this._serverCapabilities;
    }

    /**
     * Request additional context from the event source.
     */
    async requestContext(params: EnrichContextRequest['params'], options?: RequestOptions): Promise<EnrichContextResult> {
        return this.request({ method: 'context/enrich', params }, EnrichContextResultSchema, options);
    }

    /**
     * Request the event source to execute an action.
     */
    async executeAction(params: ExecuteActionRequest['params'], options?: RequestOptions): Promise<ExecuteActionResult> {
        return this.request({ method: 'actions/execute', params }, ExecuteActionResultSchema, options);
    }

    /**
     * Subscribe to event patterns on the event source.
     */
    async subscribe(params: SubscribeEventsRequest['params'], options?: RequestOptions): Promise<SubscribeEventsResult> {
        return this.request({ method: 'events/subscribe', params }, SubscribeEventsResultSchema, options);
    }

    /**
     * List available event types from the event source.
     */
    async listEventTypes(options?: RequestOptions): Promise<ListEventTypesResult> {
        return this.request({ method: 'events/list_types' }, ListEventTypesResultSchema, options);
    }

    async ping(options?: RequestOptions) {
        return this.request({ method: 'ping' }, EmptyResultSchema, options);
    }

    /**
     * Register a handler for incoming requests from the EventSource.
     */
    public override setRequestHandler<M extends RequestMethod>(
        method: M,
        handler: (request: RequestTypeMap[M], ctx: AgentContext) => ResultTypeMap[M] | Promise<ResultTypeMap[M]>
    ): void {
        return super.setRequestHandler(method, handler);
    }

    protected assertCapabilityForMethod(method: RequestMethod): void {
        switch (method) {
            case 'context/enrich': {
                if (!this._eventSourceCapabilities?.contextEnrichment) {
                    throw new SdkError(
                        SdkErrorCode.CapabilityNotSupported,
                        `EventSource does not support context enrichment (required for ${method})`
                    );
                }
                break;
            }
            case 'actions/execute': {
                if (!this._eventSourceCapabilities?.actionExecution) {
                    throw new SdkError(
                        SdkErrorCode.CapabilityNotSupported,
                        `EventSource does not support action execution (required for ${method})`
                    );
                }
                break;
            }
            case 'events/subscribe':
            case 'events/list_types':
            case 'ping': {
                break;
            }
        }
    }

    protected assertNotificationCapability(method: NotificationMethod): void {
        switch (method) {
            case 'notifications/cancelled':
            case 'notifications/progress': {
                break;
            }
        }
    }

    protected assertRequestHandlerCapability(method: string): void {
        if (!this._serverCapabilities) {
            return;
        }
        switch (method) {
            case 'events/emit': {
                if (!this._serverCapabilities.eventSubscriptions) {
                    throw new SdkError(
                        SdkErrorCode.CapabilityNotSupported,
                        `Agent does not support event subscriptions (required for ${method})`
                    );
                }
                break;
            }
            case 'ping':
            case 'initialize': {
                break;
            }
        }
    }

    protected assertTaskCapability(_method: string): void {
        // ECP does not currently use tasks
    }

    protected assertTaskHandlerCapability(_method: string): void {
        // ECP does not currently use tasks
    }
}
