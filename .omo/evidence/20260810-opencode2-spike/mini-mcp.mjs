// Minimal stdio MCP server for the omo-opencode2 spike: one tool, mini_echo.
// MCP stdio transport is newline-delimited JSON-RPC 2.0.
import readline from "node:readline"

const tools = [
  {
    name: "mini_echo",
    description: "Echo back the provided text with a mini: prefix.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
  },
]

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

readline
  .createInterface({ input: process.stdin, terminal: false })
  .on("line", (line) => {
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (msg.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: msg.params?.protocolVersion ?? "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "mini", version: "0.0.0" },
        },
      })
      return
    }
    if (msg.method === "notifications/initialized") return
    if (msg.method === "ping") return send({ jsonrpc: "2.0", id: msg.id, result: {} })
    if (msg.method === "tools/list") return send({ jsonrpc: "2.0", id: msg.id, result: { tools } })
    if (msg.method === "tools/call") {
      const text = msg.params?.arguments?.text ?? ""
      return send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `mini:${text}` }] } })
    }
    if (msg.id !== undefined) {
      send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `unknown method: ${msg.method}` } })
    }
  })
