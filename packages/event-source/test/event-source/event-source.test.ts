import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/core';
import { EventSource } from '../../src/event-source/eventSource.js';
import { AgentServer } from '../../../agent/src/agent/agentServer.js';
import type { ContextFrame, EventTypeDescriptor } from '@modelcontextprotocol/core';

describe('EventSource', () => {
    let eventSource: EventSource;
    let agentServer: AgentServer;
    let sourceTransport: InMemoryTransport;
    let agentTransport: InMemoryTransport;

    beforeEach(async () => {
        [sourceTransport, agentTransport] = InMemoryTransport.createLinkedPair();

        eventSource = new EventSource(
            { name: 'test-source', version: '1.0.0' },
            {
                capabilities: {
                    eventTypes: ['email.received', 'email.classified'],
                    contextEnrichment: true,
                    actionExecution: true
                }
            }
        );

        agentServer = new AgentServer(
            { name: 'test-agent', version: '1.0.0' },
            {
                capabilities: {
                    eventSubscriptions: ['email.*']
                }
            }
        );
    });

    it('should complete the initialize handshake', async () => {
        // Register events/emit handler on agent so handshake completes
        agentServer.setRequestHandler('events/emit', async request => {
            return {
                frameId: request.params.frame.frameId,
                status: 'handled' as const
            };
        });

        await Promise.all([eventSource.connect(sourceTransport), agentServer.connect(agentTransport)]);

        expect(eventSource.getAgentCapabilities()).toBeDefined();
        expect(agentServer.getEventSourceCapabilities()).toBeDefined();
        expect(agentServer.getEventSourceCapabilities()?.eventTypes).toContain('email.received');
    });

    it('should emit a ContextFrame and receive an ActionResult', async () => {
        agentServer.setRequestHandler('events/emit', async request => {
            return {
                frameId: request.params.frame.frameId,
                status: 'handled' as const,
                actionsTaken: [{ tool: 'archive', result: 'ok' }],
                summary: 'Archived the email'
            };
        });

        await Promise.all([eventSource.connect(sourceTransport), agentServer.connect(agentTransport)]);

        const frame: ContextFrame = {
            frameId: 'frame-1',
            source: 'gmail',
            eventType: 'email.received',
            intent: 'informational',
            urgency: 'normal',
            confidence: 0.95,
            timestamp: new Date().toISOString()
        };

        const result = await eventSource.emit(frame);
        expect(result.frameId).toBe('frame-1');
        expect(result.status).toBe('handled');
        expect(result.actionsTaken).toHaveLength(1);
        expect(result.summary).toBe('Archived the email');
    });

    it('should handle events/list_types from AgentServer', async () => {
        const eventTypes: EventTypeDescriptor[] = [
            { eventType: 'email.received', description: 'New email received' },
            { eventType: 'email.classified', description: 'Email has been classified' }
        ];

        eventSource.declareEventTypes(eventTypes);
        eventSource.setRequestHandler('events/list_types', async () => {
            return { eventTypes: eventSource.getEventTypes() };
        });

        agentServer.setRequestHandler('events/emit', async request => ({
            frameId: request.params.frame.frameId,
            status: 'handled' as const
        }));

        await Promise.all([eventSource.connect(sourceTransport), agentServer.connect(agentTransport)]);

        const result = await agentServer.listEventTypes();
        expect(result.eventTypes).toHaveLength(2);
        expect(result.eventTypes[0]!.eventType).toBe('email.received');
    });

    it('should handle context/enrich from AgentServer', async () => {
        eventSource.setRequestHandler('context/enrich', async request => {
            return {
                frameId: request.params.frameId,
                context: {
                    variables: { fullBody: 'Full email body content here...' }
                }
            };
        });

        agentServer.setRequestHandler('events/emit', async request => ({
            frameId: request.params.frame.frameId,
            status: 'handled' as const
        }));

        await Promise.all([eventSource.connect(sourceTransport), agentServer.connect(agentTransport)]);

        const result = await agentServer.requestContext({ frameId: 'frame-1' });
        expect(result.frameId).toBe('frame-1');
        expect(result.context.variables?.['fullBody']).toBe('Full email body content here...');
    });

    it('should handle actions/execute from AgentServer', async () => {
        eventSource.setRequestHandler('actions/execute', async request => {
            return {
                success: true,
                result: { messageId: 'msg-123', action: request.params.action }
            };
        });

        agentServer.setRequestHandler('events/emit', async request => ({
            frameId: request.params.frame.frameId,
            status: 'handled' as const
        }));

        await Promise.all([eventSource.connect(sourceTransport), agentServer.connect(agentTransport)]);

        const result = await agentServer.executeAction({
            frameId: 'frame-1',
            action: 'draft_reply',
            params: { body: 'Thank you for your email.' }
        });

        expect(result.success).toBe(true);
        expect((result.result as Record<string, unknown>)?.['action']).toBe('draft_reply');
    });
});
