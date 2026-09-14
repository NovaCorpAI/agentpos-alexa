/**
 * Simulated Alexa+ experience.
 *
 * Amazon's track rules accept "a simulated Alexa+ experience in a web app using your
 * preferred agentic tool" while the MCP Toolkit is US-only and in preview. This app is that:
 * a conversational client (voice or text) whose reasoning runs on Amazon Bedrock with the
 * Strands Agents SDK, which discovers the store through the bridge, calls its MCP tools,
 * renders MCP Apps (carousel, order card) and drives the UCP checkout. Purchases are paid
 * through a buyer mandate (`@agentpos/mcp-buyer`), so the demo buyer can never exceed the
 * limits its human set.
 *
 * It doubles as the public playground after launch.
 */
export const SIMULATOR_NAME = "AgentPOS Alexa+ simulator";
