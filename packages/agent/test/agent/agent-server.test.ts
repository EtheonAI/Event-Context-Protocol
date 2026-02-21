import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/core';
import type { ContextFrame } from '@modelcontextprotocol/core';
import { AgentServer } from '../../src/agent/agentServer.js';
import { EventSource } from '../../../event-source/src/event-source/eventSource.js';

describe('AgentServer', () => {
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
                    eventTypes: ['payment.received', 'payment.failed'],
                    contextEnrichment: true,
                    actionExecution: true
                }
            }
        );

        agentServer = new AgentServer(
            { name: 'test-agent', version: '1.0.0' },
            {
                capabilities: {
                    eventSubscriptions: ['payment.*']
                }
            }
        );
    });

    it('should handle initialize from EventSource', async () => {
        agentServer.setRequestHandler('events/emit', async request => ({
            frameId: request.params.frame.frameId,
            status: 'handled' as const
        }));

        await Promise.all([eventSource.connect(sourceTransport), agentServer.connect(agentTransport)]);

        expect(agentServer.getEventSourceCapabilities()).toBeDefined();
        expect(agentServer.getEventSourceVersion()?.name).toBe('test-source');
    });

    it('should handle events/emit with registered handler', async () => {
        let receivedFrame: ContextFrame | undefined;

        agentServer.setRequestHandler('events/emit', async request => {
            receivedFrame = request.params.frame;
            return {
                frameId: request.params.frame.frameId,
                status: 'handled' as const,
                summary: 'Payment processed'
            };
        });

        await Promise.all([eventSource.connect(sourceTransport), agentServer.connect(agentTransport)]);

        const frame: ContextFrame = {
            frameId: 'frame-pay-1',
            source: 'stripe',
            eventType: 'payment.failed',
            intent: 'requires_action',
            urgency: 'high',
            confidence: 0.99,
            context: {
                variables: { amount: 5000, currency: 'usd', customerId: 'cus_123' }
            },
            timestamp: new Date().toISOString()
        };

        const result = await eventSource.emit(frame);
        expect(result.status).toBe('handled');
        expect(result.summary).toBe('Payment processed');
        expect(receivedFrame?.eventType).toBe('payment.failed');
        expect(receivedFrame?.urgency).toBe('high');
    });

    it('should send requestContext to EventSource', async () => {
        eventSource.setRequestHandler('context/enrich', async request => ({
            frameId: request.params.frameId,
            context: {
                variables: { failureReason: 'Card declined', retryable: true }
            }
        }));

        agentServer.setRequestHandler('events/emit', async request => ({
            frameId: request.params.frame.frameId,
            status: 'handled' as const
        }));

        await Promise.all([eventSource.connect(sourceTransport), agentServer.connect(agentTransport)]);

        const result = await agentServer.requestContext({
            frameId: 'frame-pay-1',
            fields: ['failureReason']
        });

        expect(result.frameId).toBe('frame-pay-1');
        expect(result.context.variables?.['failureReason']).toBe('Card declined');
    });

    it('should send executeAction to EventSource', async () => {
        eventSource.setRequestHandler('actions/execute', async request => ({
            success: true,
            result: { retried: true, action: request.params.action }
        }));

        agentServer.setRequestHandler('events/emit', async request => ({
            frameId: request.params.frame.frameId,
            status: 'handled' as const
        }));

        await Promise.all([eventSource.connect(sourceTransport), agentServer.connect(agentTransport)]);

        const result = await agentServer.executeAction({
            frameId: 'frame-pay-1',
            action: 'retry_payment',
            params: { amount: 5000 }
        });

        expect(result.success).toBe(true);
    });
});
