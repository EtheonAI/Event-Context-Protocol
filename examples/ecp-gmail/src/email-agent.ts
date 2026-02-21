import { Agent } from '@etheon/ecp-agent';
import type { ContextFrame } from '@etheon/ecp-agent';

/**
 * Create an AI email agent that processes classified emails.
 *
 * Demonstrates:
 * - Pattern-based event matching with urgency/intent filters
 * - Context enrichment (requesting full email body on demand)
 * - Action execution (draft replies, forward, archive)
 * - Token savings: agent receives pre-classified, pre-extracted data
 */
export function createEmailAgent(): Agent {
    const agent = new Agent(
        { name: 'email-agent', version: '1.0.0' },
        {
            capabilities: {
                eventSubscriptions: ['email.*'],
                tools: ['draft_reply', 'archive', 'forward']
            }
        }
    );

    // Handler for actionable classified emails
    agent.on(
        'email.classified',
        async (frame: ContextFrame) => {
            console.log(`\n[Email Agent] Processing actionable email: ${frame.semanticLabel}`);
            console.log(`  Subject: ${frame.context?.variables?.['subject']}`);
            console.log(`  From: ${frame.context?.variables?.['sender']}`);
            console.log(`  Urgency: ${frame.urgency}, Confidence: ${frame.confidence}`);

            switch (frame.semanticLabel) {
                case 'COURT_ORDER': {
                    // Step 1: Enrich - get the full email body
                    console.log('  -> Requesting full email body...');
                    const enriched = await agent.requestContext({ frameId: frame.frameId });
                    const fullBody = enriched.context.variables?.['fullBody'] as string;
                    console.log(`  -> Got ${fullBody.length} chars of body text`);

                    // Step 2: Execute - draft a reply acknowledging the court order
                    const deadline = frame.context?.variables?.['deadline'] as string;
                    const caseNumber = frame.context?.variables?.['caseNumber'] as string;
                    console.log(`  -> Drafting reply for case #${caseNumber}, deadline: ${deadline}`);

                    const draftResult = await agent.executeAction({
                        frameId: frame.frameId,
                        action: 'draft_reply',
                        params: {
                            body: `Dear Clerk,\n\nI acknowledge receipt of the court order for Case #${caseNumber}.\nI will ensure compliance by the deadline of ${deadline}.\n\nRegards`
                        }
                    });

                    return {
                        frameId: frame.frameId,
                        status: 'handled' as const,
                        actionsTaken: [
                            { tool: 'context/enrich', result: 'Retrieved full body' },
                            { tool: 'draft_reply', result: draftResult.result }
                        ],
                        summary: `Court order for case #${caseNumber} acknowledged, reply drafted`
                    };
                }

                case 'INVOICE': {
                    // Forward to accounting
                    const invoiceNum = frame.context?.variables?.['invoiceNumber'] as string;
                    const amount = frame.context?.variables?.['amount'] as number;
                    console.log(`  -> Forwarding invoice ${invoiceNum} ($${amount}) to accounting`);

                    const fwdResult = await agent.executeAction({
                        frameId: frame.frameId,
                        action: 'forward',
                        params: { to: 'accounting@company.com' }
                    });

                    return {
                        frameId: frame.frameId,
                        status: 'handled' as const,
                        actionsTaken: [
                            { tool: 'forward', params: { to: 'accounting@company.com' }, result: fwdResult.result }
                        ],
                        summary: `Invoice ${invoiceNum} forwarded to accounting`
                    };
                }

                default:
                    return {
                        frameId: frame.frameId,
                        status: 'deferred' as const,
                        summary: `Unhandled semantic label: ${frame.semanticLabel}`
                    };
            }
        },
        { intentFilter: ['requires_action'] }
    );

    // Handler for informational emails (logging only)
    agent.on(
        'email.*',
        async (frame: ContextFrame) => {
            console.log(`\n[Email Agent] Logged informational email: ${frame.semanticLabel}`);
            console.log(`  Subject: ${frame.context?.variables?.['subject']}`);
            return {
                frameId: frame.frameId,
                status: 'handled' as const,
                summary: `Logged: ${frame.semanticLabel} email from ${frame.context?.variables?.['sender']}`
            };
        },
        { intentFilter: ['informational'] }
    );

    return agent;
}
