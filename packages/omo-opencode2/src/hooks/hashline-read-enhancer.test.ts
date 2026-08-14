import { describe, expect, test, mock } from "bun:test"
import { registerHashlineReadEnhancer, transformOutput } from "./hashline-read-enhancer"

describe("Hashline Read Enhancer Hook", () => {
  describe("#given a read result with line numbers", () => {
    test("#when transformed #then it appends LINE#ID hash", () => {
      const input = "1: function hello() {\n2:   return true;\n3: }"
      const result = transformOutput(input)
      expect(result).toMatch(/^1#[A-Z]{2}\|function hello\(\) \{/m)
      expect(result).toMatch(/^2#[A-Z]{2}\|  return true;/m)
      expect(result).toMatch(/^3#[A-Z]{2}\|\}/m)
    })
  })

  describe("#given a read result that is already tagged (idempotency)", () => {
    test("#when transformed #then it is unchanged", () => {
      const input = "1#VK|function hello() {\n2#XJ|  return true;\n3#MB|}"
      // Actually transformLine checks if it ends with truncation, or parses line.
      // parseReadLine only checks for `\d+:` or `\d+\|`. It does NOT match `\d+#`.
      // So if it's already tagged, parseReadLine returns null.
      // And the function handles this by just appending the rest of the lines verbatim!
      const result = transformOutput(input)
      expect(result).toEqual(input)
    })
  })

  describe("#given a result string with XML tags", () => {
    test("#when transformed #then it tags lines inside the XML tags", () => {
      const input = "<content>\n1: function hello() {\n2:   return true;\n3: }\n</content>"
      const result = transformOutput(input)
      expect(result).toContain("<content>")
      expect(result).toContain("1#")
      expect(result).toContain("</content>")
    })
  })

  describe("#given a read result with a header", () => {
    test("#when transformed #then it tags lines and preserves header", () => {
      const input = "Read file test.txt, lines 1-2\n1: const x = 1;\n2: const y = 2;"
      const result = transformOutput(input)
      expect(result).toMatch(/^Read file test\.txt, lines 1-2$/m)
      expect(result).toMatch(/^1#[A-Z]{2}\|const x = 1;/m)
      expect(result).toMatch(/^2#[A-Z]{2}\|const y = 2;/m)
    })
  })

  describe("#given the execute.after hook", () => {
    test("#when content is an array of parts #then it transforms text parts", () => {
      let registeredHandler: any
      const ctx = {
        tool: {
          hook: mock((name, handler) => {
            registeredHandler = handler
          }),
        },
      }
      
      registerHashlineReadEnhancer(ctx as any)
      
      expect(registeredHandler).toBeDefined()
      
      const event = {
        tool: "read",
        status: "completed",
        result: {
          content: [
            { type: "image", data: "..." },
            { type: "text", text: "1: const x = 1;" }
          ]
        }
      }
      
      registeredHandler(event)
      
      expect(event.result.content).toBeArray()
      expect(event.result.content[0]).toEqual({ type: "image", data: "..." })
      expect((event.result.content[1] as any).text).toMatch(/^1#[A-Z]{2}\|const x = 1;/)
    })

    test("#when tool is not read #then it ignores", () => {
      let registeredHandler: any
      const ctx = {
        tool: { hook: mock((name, handler) => { registeredHandler = handler }) },
      }
      registerHashlineReadEnhancer(ctx as any)
      
      const event = {
        tool: "edit",
        status: "completed",
        result: { content: "1: const x = 1;" }
      }
      
      registeredHandler(event)
      expect(event.result.content).toEqual("1: const x = 1;")
    })
  })
})
