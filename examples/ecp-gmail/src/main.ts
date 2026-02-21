import { InMemoryTransport } from '@etheon/ecp-agent';
import { createGmailSource, getSampleEmails } from './gmail-source.js';
import { createEmailAgent } from './email-agent.js';

/**
 * ECP Gmail Example - Full end-to-end demonstration
 *
 * Shows how:
 * 1. A Gmail event source emits pre-classified, context-rich events
 * 2. An AI agent receives events via pattern matching
 * 3. The agent enriches context on-demand (full email body)
 * 4. The agent executes actions back on the source (draft, forward, archive)
 *
 * No custom integration code. No dumb webhooks. No token waste.
 */
async function main() {
    console.log('=== ECP Gmail Example ===\n');

    // Create the linked transport pair
    const [sourceTransport, agentTransport] = InMemoryTransport.createLinkedPair();

    // Create source and agent
    const gmailSource = createGmailSource();
    const emailAgent = createEmailAgent();

    // Connect (EventSource initiates, AgentServer responds)
    console.log('Connecting Gmail source to email agent...');
    await Promise.all([
        gmailSource.connect(sourceTransport),
        emailAgent.connect(agentTransport)
    ]);
    console.log('Connected!\n');

    // List available event types
    const types = await emailAgent.listEventTypes();
    console.log('Available event types:');
    for (const t of types.eventTypes) {
        console.log(`  - ${t.eventType}: ${t.description}`);
    }

    // Process each sample email
    const emails = getSampleEmails();
    console.log(`\nProcessing ${emails.length} emails...\n`);
    console.log('---');

    for (const email of emails) {
        const result = await gmailSource.emit(email);
        console.log(`\n  Result: [${result.status}] ${result.summary ?? '(no summary)'}`);
        if (result.actionsTaken && result.actionsTaken.length > 0) {
            console.log(`  Actions: ${result.actionsTaken.map(a => a.tool).join(', ')}`);
        }
        console.log('---');
    }

    console.log('\nDone! All emails processed.');

    // Cleanup
    await gmailSource.close();
}

main().catch(console.error);
