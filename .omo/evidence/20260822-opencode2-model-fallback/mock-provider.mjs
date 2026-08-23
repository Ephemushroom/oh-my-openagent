import { createServer } from "node:http"
import { writeFileSync } from "node:fs"

const portFile = process.argv[2]
if (!portFile) throw new Error("port file argument is required")

const server = createServer((request, response) => {
  request.resume()
  response.writeHead(429, { "content-type": "application/json" })
  response.end(JSON.stringify({
    error: {
      type: "insufficient_quota",
      code: "insufficient_quota",
      message: "Subscription quota exhausted for the forced fallback QA provider.",
    },
  }))
})

server.listen(0, "127.0.0.1", () => {
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("mock provider did not bind a TCP port")
  writeFileSync(portFile, String(address.port))
})

const shutdown = () => server.close(() => process.exit(0))
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
