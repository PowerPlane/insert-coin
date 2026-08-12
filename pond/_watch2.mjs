import { createClient } from "@libsql/client";
for (let i = 1; i <= 10; i++) {
  await new Promise((r) => setTimeout(r, 180000));
  const c = createClient({ url: "libsql://pond-dav1dyang.aws-us-east-1.turso.io", authToken: process.env.OLD });
  try {
    await c.execute("SELECT 1");
    console.log(`${new Date().toISOString().slice(11,19)}  check ${i}: still accepted`);
  } catch (e) {
    console.log(`${new Date().toISOString().slice(11,19)}  check ${i}: REJECTED — ${e.message.slice(0,70)}`);
    process.exit(0);
  }
  try { c.close(); } catch {}
}
console.log("30 minutes past invalidate and still live — rebuild the database");
