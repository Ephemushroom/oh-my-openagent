import { runOpenCode2Installer } from "../../../packages/omo-opencode/src/cli/install-opencode2"

const result = await runOpenCode2Installer()
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
