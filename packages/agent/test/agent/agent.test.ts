import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/core';
import type { ContextFrame } from '@modelcontextprotocol/core';
import { Agent } from '../../src/agent/agent.js';
import { EventSource } from '../../../event-source/src/event-source/eventSource.js';

describe('Agent', () => {
    let eventSource: EventSource;
    let agent: Agent;
    let sourceTransport: InMemoryTransport;
    let agentTransport: InMemoryTransport;

    beforeEach(() => {
        [sourceTransport, agentTransport] = InMemoryTransport.createLinkedPair();

        eventSource = new EventSource(
            { name: 'test-source', version: '1.0.0' },
            {
                capabilities: {
                    eventTypes: ['payment.received', 'payment.failed', 'email.received', 'email.classified'],
                    contextEnrichment: true,
                    actionExecution: true
                }
            }
        );

        agent = new Agent(
            { name: 'test-agent', version: '1.0.0' },
            {
                capabilities: {
                    eventSubscriptions: ['payment.*', 'email.*']
                }
            }
        );
    });

    it('should match payment.* pattern to payment.failed', async () => {
        let matched = false;
        agent.on('payment.*', async frame => {
            matched = true;
            return {
                frameId: frame.frameId,
                status: 'handled' as const
            };
        });

        await Promise.all([eventSource.connect(sourceTransport), agent.connect(agentTransport)]);

        const frame: ContextFrame = {
            frameId: 'f1',
            source: 'stripe',
            eventType: 'payment.failed',
            intent: 'requires_action',
            urgency: 'high',
            confidence: 0.99,
            timestamp: new Date().toISOString()
        };

        const result = await eventSource.emit(frame);
        expect(matched).toBe(true);
        expect(result.status).toBe('handled');
    });

    it('should filter by urgency', async () => {
        let handlerCalled = false;
        agent.on(
            'payment.*',
            async frame => {
                handlerCalled = true;
                return { frameId: frame.frameId, status: 'handled' as const };
            },
            { urgencyFilter: ['high', 'critical'] }
        );

        await Promise.all([eventSource.connect(sourceTransport), agent.connect(agentTransport)]);

        // Low urgency should not match
        const lowFrame: ContextFrame = {
            frameId: 'f1',
            source: 'stripe',
            eventType: 'payment.received',
            intent: 'informational',
            urgency: 'low',
            confidence: 0.9,
            timestamp: new Date().toISOString()
        };

        const result = await eventSource.emit(lowFrame);
        expect(handlerCalled).toBe(false);
        expect(result.status).toBe('deferred');
    });

    it('should filter by intent', async () => {
        let handlerCalled = false;
        agent.on(
            'email.*',
            async frame => {
                handlerCalled = true;
                return { frameId: frame.frameId, status: 'handled' as const };
            },
            { intentFilter: ['requires_action'] }
        );

        await Promise.all([eventSource.connect(sourceTransport), agent.connect(agentTransport)]);

        // Informational should not match
        const infoFrame: ContextFrame = {
            frameId: 'f1',
            source: 'gmail',
            eventType: 'email.received',
            intent: 'informational',
            urgency: 'normal',
            confidence: 0.85,
            timestamp: new Date().toISOString()
        };

        const result = await eventSource.emit(infoFrame);
        expect(handlerCalled).toBe(false);
        expect(result.status).toBe('deferred');
    });

    it('should execute multiple matching handlers', async () => {
        const callOrder: string[] = [];

        agent.on('payment.*', async frame => {
            callOrder.push('handler1');
            return { frameId: frame.frameId, status: 'handled' as const, summary: 'First' };
        });

        agent.on('payment.failed', async frame => {
            callOrder.push('handler2');
            return { frameId: frame.frameId, status: 'handled' as const, summary: 'Second' };
        });

        await Promise.all([eventSource.connect(sourceTransport), agent.connect(agentTransport)]);

        const frame: ContextFrame = {
            frameId: 'f1',
            source: 'stripe',
            eventType: 'payment.failed',
            intent: 'requires_action',
            urgency: 'high',
            confidence: 0.99,
            timestamp: new Date().toISOString()
        };

        const result = await eventSource.emit(frame);
        expect(callOrder).toEqual(['handler1', 'handler2']);
        // Last handler's result is returned
        expect(result.summary).toBe('Second');
    });

    it('should return deferred for unmatched events', async () => {
        agent.on('email.*', async frame => {
            return { frameId: frame.frameId, status: 'handled' as const };
        });

        await Promise.all([eventSource.connect(sourceTransport), agent.connect(agentTransport)]);

        const frame: ContextFrame = {
            frameId: 'f1',
            source: 'stripe',
            eventType: 'payment.failed',
            intent: 'requires_action',
            urgency: 'high',
            confidence: 0.99,
            timestamp: new Date().toISOString()
        };

        const result = await eventSource.emit(frame);
        expect(result.status).toBe('deferred');
    });

    describe('glob matching', () => {
        it('should match ** for any depth', () => {
            expect(agent._matchGlob('email.**', 'email.received')).toBe(true);
            expect(agent._matchGlob('email.**', 'email.received.urgent')).toBe(true);
            expect(agent._matchGlob('**', 'anything.here')).toBe(true);
        });

        it('should match * for single segment', () => {
            expect(agent._matchGlob('payment.*', 'payment.failed')).toBe(true);
            expect(agent._matchGlob('payment.*', 'payment.received')).toBe(true);
            expect(agent._matchGlob('payment.*', 'payment.sub.detail')).toBe(false);
        });

        it('should match exact strings', () => {
            expect(agent._matchGlob('payment.failed', 'payment.failed')).toBe(true);
            expect(agent._matchGlob('payment.failed', 'payment.received')).toBe(false);
        });
    });
});
