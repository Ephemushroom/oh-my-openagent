import { Database } from "bun:sqlite"

const [, , dbPath, mode, arg] = process.argv
if (!dbPath || !mode) {
  console.log("0")
  process.exit(1)
}

try {
  const db = new Database(dbPath, { readonly: true })
  if (mode === "sessions") {
    const row = db.query("SELECT count(*) AS c FROM session_v2").get() as { c: number }
    console.log(String(row.c))
  } else if (mode === "marker") {
    const row = db
      .query("SELECT count(*) AS c FROM session_message WHERE data LIKE ?")
      .get(`%${arg ?? ""}%`) as { c: number }
    console.log(String(row.c))
  } else {
    console.log("0")
  }
  db.close()
} catch {
  console.log("0")
}
