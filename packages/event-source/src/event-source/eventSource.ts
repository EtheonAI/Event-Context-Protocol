import type {
    ActionResult,
    BaseContext,
    ContextFrame,
    EventSourceCapabilities,
    EventTypeDescriptor,
    Implementation,
    MessageExtraInfo,
    NotificationMethod,
    ProtocolOptions,
    RequestMethod,
    RequestOptions,
    RequestTypeMap,
    ResultTypeMap,
    ServerCapabilities,
    Transport
} from '@modelcontextprotocol/core';
import {
    ActionResultSchema,
    EmptyResultSchema,
    InitializeResultSchema,
    LATEST_PROTOCOL_VERSION,
    Protocol,
    SdkError,
    SdkErrorCode
} from '@modelcontextprotocol/core';

/**
 * Context provided to event source request handlers.
 */
export type EventSourceContext = BaseContext;

export type EventSourceOptions = ProtocolOptions & {
    capabilities?: EventSourceCapabilities;
};

/**
 * An ECP event source on top of a pluggable transport.
 *
 * The event source acts as the client role (initiates connection),
 * sending events to an AgentServer and handling requests back from it.
 */
export class EventSource extends Protocol<EventSourceContext> {
    private _agentCapabilities?: ServerCapabilities;
    private _agentVersion?: Implementation;
    private _capabilities: EventSourceCapabilities;
    private _eventTypes: EventTypeDescriptor[] = [];

    constructor(
        private _sourceInfo: Implementation,
        options?: EventSourceOptions
    ) {
        super(options);
        this._capabilities = options?.capabilities ?? {};
    }

    protected override buildContext(ctx: BaseContext, _transportInfo?: MessageExtraInfo): EventSourceContext {
        return ctx;
    }

    override async connect(transport: Transport, options?: RequestOptions): Promise<void> {
        await super.connect(transport);
        if (transport.sessionId !== undefined) {
            return;
        }
        try {
            const result = await this.request(
                {
                    method: 'initialize',
                    params: {
                        protocolVersion: this._supportedProtocolVersions[0] ?? LATEST_PROTOCOL_VERSION,
                        capabilities: {
                            events: this._capabilities
                        },
                        clientInfo: this._sourceInfo
                    }
                },
                InitializeResultSchema,
                options
            );

            if (result === undefined) {
                throw new Error(`AgentServer sent invalid initialize result: ${result}`);
            }

            if (!this._supportedProtocolVersions.includes(result.protocolVersion)) {
                throw new Error(`AgentServer's protocol version is not supported: ${result.protocolVersion}`);
            }

            this._agentCapabilities = result.capabilities;
            this._agentVersion = result.serverInfo;
            if (transport.setProtocolVersion) {
                transport.setProtocolVersion(result.protocolVersion);
            }

            await this.notification({
                method: 'notifications/initialized'
            });
        } catch (error) {
            void this.close();
            throw error;
        }
    }

    /**
     * Emit a context frame to the agent.
     */
    async emit(frame: ContextFrame, options?: RequestOptions): Promise<ActionResult> {
        return this.request({ method: 'events/emit', params: { frame } }, ActionResultSchema, options);
    }

    /**
     * Declare available event types for this source.
     */
    declareEventTypes(types: EventTypeDescriptor[]): void {
        this._eventTypes = types;
    }

    /**
     * Get the declared event types.
     */
    getEventTypes(): EventTypeDescriptor[] {
        return this._eventTypes;
    }

    /**
     * After initialization, get the agent's reported capabilities.
     */
    getAgentCapabilities(): ServerCapabilities | undefined {
        return this._agentCapabilities;
    }

    /**
     * After initialization, get the agent's version info.
     */
    getAgentVersion(): Implementation | undefined {
        return this._agentVersion;
    }

    async ping(options?: RequestOptions) {
        return this.request({ method: 'ping' }, EmptyResultSchema, options);
    }

    /**
     * Register a handler for incoming requests from the AgentServer.
     */
    public override setRequestHandler<M extends RequestMethod>(
        method: M,
        handler: (request: RequestTypeMap[M], ctx: EventSourceContext) => ResultTypeMap[M] | Promise<ResultTypeMap[M]>
    ): void {
        return super.setRequestHandler(method, handler);
    }

    protected assertCapabilityForMethod(method: RequestMethod): void {
        switch (method) {
            case 'initialize':
            case 'ping':
            case 'events/emit': {
                break;
            }
        }
    }

    protected assertNotificationCapability(method: NotificationMethod): void {
        switch (method) {
            case 'notifications/initialized':
            case 'notifications/cancelled':
            case 'notifications/progress':
            case 'notifications/events/types_changed': {
                break;
            }
        }
    }

    protected assertRequestHandlerCapability(method: string): void {
        switch (method) {
            case 'events/subscribe':
            case 'events/list_types':
            case 'ping': {
                break;
            }
            case 'context/enrich': {
                if (!this._capabilities.contextEnrichment) {
                    throw new SdkError(
                        SdkErrorCode.CapabilityNotSupported,
                        `EventSource does not support context enrichment (required for ${method})`
                    );
                }
                break;
            }
            case 'actions/execute': {
                if (!this._capabilities.actionExecution) {
                    throw new SdkError(
                        SdkErrorCode.CapabilityNotSupported,
                        `EventSource does not support action execution (required for ${method})`
                    );
                }
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
