// Paste this into the browser DevTools console while a chat is open
// (http://localhost:3001/?threadId=...). It downloads the active thread
// as a plain-text file with the raw markdown the agent generated —
// useful for inspecting [[slug|«quote»]] markers, partial-stream
// artefacts, or anything else.
//
// You can also pass a specific threadId: `dumpThread("a9030264-...")`.
// With no argument it picks the threadId from the URL, falling back to
// the most-recently-updated thread in localStorage.

(() => {
  function pickText(content) {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((c) => {
          if (typeof c === "string") return c;
          if (c && typeof c === "object" && c.type === "text") return c.text ?? "";
          return "";
        })
        .join("");
    }
    return "";
  }

  function compactJson(s, max = 400) {
    try {
      const obj = JSON.parse(s);
      const oneLine = JSON.stringify(obj);
      return oneLine.length > max ? oneLine.slice(0, max) + "…" : oneLine;
    } catch {
      return s.length > max ? s.slice(0, max) + "…" : s;
    }
  }

  function format(thread) {
    const lines = [];
    lines.push(`# ${thread.title || "(no title)"}`);
    lines.push(`# thread: ${thread.id}`);
    lines.push(`# created: ${new Date(thread.createdAt).toISOString()}`);
    lines.push(`# updated: ${new Date(thread.updatedAt).toISOString()}`);
    lines.push(`# messages: ${thread.messages.length}`);
    lines.push("");
    thread.messages.forEach((m, i) => {
      const header = `--- [${i + 1}] ${(m.type || "?").toUpperCase()}${m.name ? ` (${m.name})` : ""}${m.tool_call_id ? ` ← ${m.tool_call_id}` : ""} ---`;
      lines.push(header);
      if (m.type === "tool") {
        lines.push(compactJson(pickText(m.content)));
      } else if (m.type === "ai" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
        const text = pickText(m.content);
        if (text.trim()) {
          lines.push(text);
          lines.push("");
        }
        m.tool_calls.forEach((tc) => {
          lines.push(`>>> call ${tc.name} (${tc.id})`);
          lines.push(JSON.stringify(tc.args ?? {}));
        });
      } else {
        lines.push(pickText(m.content));
      }
      lines.push("");
    });
    return lines.join("\n");
  }

  window.dumpThread = function dumpThread(forceId) {
    const raw = localStorage.getItem("patristic:threads");
    if (!raw) {
      console.warn("No threads in localStorage.");
      return;
    }
    const all = JSON.parse(raw);
    const urlId = new URL(location.href).searchParams.get("threadId");
    const id = forceId || urlId || (all.sort((a, b) => b.updatedAt - a.updatedAt)[0] || {}).id;
    const thread = all.find((t) => t.id === id);
    if (!thread) {
      console.warn(`Thread ${id} not found. Available: ${all.map((t) => t.id).join(", ")}`);
      return;
    }
    const text = format(thread);
    const date = new Date(thread.updatedAt).toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const filename = `chat-${thread.id.slice(0, 8)}-${date}.txt`;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log(`Dumped ${thread.messages.length} messages → ${filename}`);
    return text;
  };

  console.log("dumpThread() ready. Call with no args for the active thread, or dumpThread('<id>').");
})();
