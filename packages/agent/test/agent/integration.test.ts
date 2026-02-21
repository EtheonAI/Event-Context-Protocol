import { describe, it, expect } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/core';
import type { ContextFrame } from '@modelcontextprotocol/core';
import { Agent } from '../../src/agent/agent.js';
import { EventSource } from '../../../event-source/src/event-source/eventSource.js';

describe('ECP Integration: EventSource ↔ Agent round-trip', () => {
    it('should complete a full event → enrich → execute flow', async () => {
        const [sourceTransport, agentTransport] = InMemoryTransport.createLinkedPair();

        // Create event source with full capabilities
        const eventSource = new EventSource(
            { name: 'gmail-source', version: '1.0.0' },
            {
                capabilities: {
                    eventTypes: ['email.classified'],
                    contextEnrichment: true,
                    actionExecution: true
                }
            }
        );

        // Set up context enrichment handler
        eventSource.setRequestHandler('context/enrich', async request => {
            return {
                frameId: request.params.frameId,
                context: {
                    variables: {
                        fullBody: 'Dear counsel, please find attached the court order...',
                        attachments: ['court_order.pdf']
                    }
                }
            };
        });

        // Set up action execution handler
        const executedActions: Array<{ action: string; params?: Record<string, unknown> }> = [];
        eventSource.setRequestHandler('actions/execute', async request => {
            executedActions.push({
                action: request.params.action,
                params: request.params.params as Record<string, unknown> | undefined
            });
            return {
                success: true,
                result: { messageId: `reply-${Date.now()}` }
            };
        });

        // Set up event type listing handler
        eventSource.declareEventTypes([{ eventType: 'email.classified', description: 'An email that has been classified' }]);
        eventSource.setRequestHandler('events/list_types', async () => {
            return { eventTypes: eventSource.getEventTypes() };
        });

        // Create agent
        const agent = new Agent(
            { name: 'email-agent', version: '1.0.0' },
            {
                capabilities: {
                    eventSubscriptions: ['email.*']
                }
            }
        );

        // Register handler for classified emails requiring action
        agent.on(
            'email.classified',
            async (frame, _ctx) => {
                // Step 1: Request enrichment
                const enriched = await agent.requestContext({ frameId: frame.frameId });

                // Step 2: Execute action based on semantic label
                if (frame.semanticLabel === 'COURT_ORDER') {
                    await agent.executeAction({
                        frameId: frame.frameId,
                        action: 'draft_reply',
                        params: {
                            body: `Acknowledged receipt of court order. Full body: ${enriched.context.variables?.['fullBody']}`
                        }
                    });
                }

                return {
                    frameId: frame.frameId,
                    status: 'handled' as const,
                    actionsTaken: [
                        { tool: 'context/enrich', result: 'enriched' },
                        { tool: 'draft_reply', result: 'drafted' }
                    ],
                    summary: 'Court order acknowledged and reply drafted'
                };
            },
            { intentFilter: ['requires_action'] }
        );

        // Connect
        await Promise.all([eventSource.connect(sourceTransport), agent.connect(agentTransport)]);

        // Emit a court order email event
        const frame: ContextFrame = {
            frameId: 'frame-court-1',
            source: 'gmail',
            eventType: 'email.classified',
            semanticLabel: 'COURT_ORDER',
            intent: 'requires_action',
            urgency: 'critical',
            confidence: 0.97,
            context: {
                variables: {
                    sender: 'court@example.com',
                    subject: 'Case #12345 - Court Order',
                    caseNumber: '12345'
                },
                suggestedTools: [{ name: 'draft_reply', reason: 'Court orders typically require acknowledgment' }]
            },
            timestamp: new Date().toISOString()
        };

        const result = await eventSource.emit(frame);

        // Verify the full round-trip
        expect(result.status).toBe('handled');
        expect(result.summary).toBe('Court order acknowledged and reply drafted');
        expect(result.actionsTaken).toHaveLength(2);

        // Verify the action was executed on the source
        expect(executedActions).toHaveLength(1);
        expect(executedActions[0]!.action).toBe('draft_reply');
        expect(executedActions[0]!.params?.['body'] as string).toContain('court order');

        // Verify list event types works
        const types = await agent.listEventTypes();
        expect(types.eventTypes).toHaveLength(1);
        expect(types.eventTypes[0]!.eventType).toBe('email.classified');

        // Cleanup
        await eventSource.close();
    });
});
