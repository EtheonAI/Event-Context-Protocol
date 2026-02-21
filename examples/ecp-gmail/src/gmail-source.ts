import type { ContextFrame, EventTypeDescriptor } from '@etheon/ecp-event-source';
import { EventSource } from '@etheon/ecp-event-source';

/**
 * Simulated Gmail Event Source.
 *
 * In production, this would be backed by the Gmail API push notifications.
 * Here we simulate email events with pre-classified, pre-extracted data.
 */
export function createGmailSource(): EventSource {
    const source = new EventSource(
        { name: 'gmail-source', version: '1.0.0' },
        {
            capabilities: {
                eventTypes: ['email.received', 'email.classified'],
                contextEnrichment: true,
                actionExecution: true
            }
        }
    );

    // Declare event types
    const eventTypes: EventTypeDescriptor[] = [
        {
            eventType: 'email.received',
            description: 'A new email has been received in the inbox'
        },
        {
            eventType: 'email.classified',
            description: 'An email has been classified with semantic labels and extracted entities'
        }
    ];
    source.declareEventTypes(eventTypes);

    // Handle list_types requests
    source.setRequestHandler('events/list_types', async () => {
        return { eventTypes: source.getEventTypes() };
    });

    // Handle subscription requests
    source.setRequestHandler('events/subscribe', async (request) => {
        console.log('[Gmail Source] Agent subscribed to:', request.params.patterns);
        return { subscribed: request.params.patterns };
    });

    // Simulated email bodies for context enrichment
    const emailBodies: Record<string, string> = {
        'frame-court-1':
            'Dear Counsel,\n\nPlease find attached the court order for Case #12345.\nYou are required to respond by March 15, 2026.\n\nRegards,\nClerk of Court',
        'frame-invoice-1':
            'Invoice #INV-2024-789\nAmount Due: $15,000.00\nDue Date: February 28, 2026\nPayment Terms: Net 30',
        'frame-marketing-1': 'Big Sale! 50% off everything this weekend only!',
        'frame-personal-1': 'Hey, are we still on for dinner tonight at 7pm?'
    };

    // Handle context enrichment
    source.setRequestHandler('context/enrich', async (request) => {
        const body = emailBodies[request.params.frameId] ?? 'Email body not found';
        console.log(`[Gmail Source] Enriching context for frame ${request.params.frameId}`);
        return {
            frameId: request.params.frameId,
            context: {
                variables: {
                    fullBody: body,
                    headers: {
                        'content-type': 'text/plain',
                        'message-id': `<${request.params.frameId}@gmail.com>`
                    }
                }
            }
        };
    });

    // Handle action execution
    source.setRequestHandler('actions/execute', async (request) => {
        const { action, params, frameId } = request.params;
        console.log(`[Gmail Source] Executing action "${action}" for frame ${frameId}:`, params);

        switch (action) {
            case 'draft_reply':
                return {
                    success: true,
                    result: {
                        draftId: `draft-${Date.now()}`,
                        action: 'draft_reply',
                        body: (params as Record<string, unknown>)?.['body']
                    }
                };
            case 'archive':
                return { success: true, result: { archived: true } };
            case 'forward':
                return {
                    success: true,
                    result: {
                        forwarded: true,
                        to: (params as Record<string, unknown>)?.['to']
                    }
                };
            default:
                return { success: false, error: `Unknown action: ${action}` };
        }
    });

    return source;
}

/**
 * Create sample email events for demonstration.
 */
export function getSampleEmails(): ContextFrame[] {
    const now = new Date().toISOString();

    return [
        {
            frameId: 'frame-court-1',
            source: 'gmail',
            eventType: 'email.classified',
            semanticLabel: 'COURT_ORDER',
            intent: 'requires_action',
            urgency: 'critical',
            confidence: 0.97,
            context: {
                variables: {
                    sender: 'clerk@court.example.com',
                    subject: 'Case #12345 - Court Order',
                    caseNumber: '12345',
                    deadline: '2026-03-15'
                },
                suggestedTools: [
                    { name: 'draft_reply', reason: 'Court orders require acknowledgment within deadline' }
                ]
            },
            idempotencyKey: 'gmail-msg-court-12345',
            timestamp: now
        },
        {
            frameId: 'frame-invoice-1',
            source: 'gmail',
            eventType: 'email.classified',
            semanticLabel: 'INVOICE',
            intent: 'requires_action',
            urgency: 'high',
            confidence: 0.92,
            context: {
                variables: {
                    sender: 'billing@vendor.example.com',
                    subject: 'Invoice #INV-2024-789 - Due Feb 28',
                    invoiceNumber: 'INV-2024-789',
                    amount: 15000,
                    currency: 'USD',
                    dueDate: '2026-02-28'
                },
                suggestedTools: [
                    { name: 'forward', reason: 'Invoices should be forwarded to accounting' }
                ]
            },
            idempotencyKey: 'gmail-msg-invoice-789',
            timestamp: now
        },
        {
            frameId: 'frame-marketing-1',
            source: 'gmail',
            eventType: 'email.classified',
            semanticLabel: 'MARKETING',
            intent: 'informational',
            urgency: 'low',
            confidence: 0.99,
            context: {
                variables: {
                    sender: 'deals@shop.example.com',
                    subject: 'Big Sale This Weekend!'
                }
            },
            idempotencyKey: 'gmail-msg-marketing-001',
            timestamp: now
        },
        {
            frameId: 'frame-personal-1',
            source: 'gmail',
            eventType: 'email.classified',
            semanticLabel: 'PERSONAL',
            intent: 'informational',
            urgency: 'normal',
            confidence: 0.88,
            context: {
                variables: {
                    sender: 'friend@example.com',
                    subject: 'Dinner tonight?'
                }
            },
            idempotencyKey: 'gmail-msg-personal-001',
            timestamp: now
        }
    ];
}
