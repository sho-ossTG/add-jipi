function redactIp(ip) {
  if (!ip || ip === "unknown") return "unknown";
  return "[redacted]";
}

function sanitizeInternalError() {
  return "internal_error";
}

function renderQuarantinePage(input = {}) {
  const eventsRaw = Array.isArray(input.eventsRaw) ? input.eventsRaw : [];
  const maxSessions = Number(input.maxSessions || 0);
  const activeCount = Number(input.activeCount || 0);
  const slotTaken = Number(input.slotTaken || 0);
  const brokerErrors = Number(input.brokerErrors || 0);

  const events = eventsRaw.map((entry) => {
    try {
      const event = typeof entry === "string" ? JSON.parse(entry) : entry;
      return {
        time: event && event.time ? String(event.time) : "",
        ip: redactIp(event && event.ip),
        episodeId: event && event.episodeId ? String(event.episodeId) : "",
        error: sanitizeInternalError(event && event.error)
      };
    } catch {
      return { time: "", ip: "unknown", episodeId: "", error: "internal_error" };
    }
  });

  const rows = events.map((event) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #444">${event.time}</td>
      <td style="padding:8px;border-bottom:1px solid #444">${event.ip}</td>
      <td style="padding:8px;border-bottom:1px solid #444">${event.episodeId}</td>
      <td style="padding:8px;border-bottom:1px solid #444;color:#ff6b6b">${event.error}</td>
    </tr>
  `).join("");

  return `
    <html>
      <body style="background:#1a1a1a;color:#eee;font-family:sans-serif;padding:2rem">
        <h2>Quarantine Events (Last 50)</h2>
        <p><b>Stats:</b> Active Sessions: ${activeCount}/${maxSessions} | Slot Taken Blocks: ${slotTaken} | Broker Errors: ${brokerErrors}</p>
        <table style="width:100%;border-collapse:collapse;background:#2a2a2a">
          <thead>
            <tr style="background:#333">
              <th style="padding:8px;text-align:left">Time</th>
              <th style="padding:8px;text-align:left">IP</th>
              <th style="padding:8px;text-align:left">Episode</th>
              <th style="padding:8px;text-align:left">Error</th>
            </tr>
          </thead>
          <tbody>${rows || "<tr><td colspan='4' style='padding:20px;text-align:center'>No events</td></tr>"}</tbody>
        </table>
        <br><a href="/" style="color:#8A5BB8">Back to Home</a>
      </body>
    </html>
  `;
}

module.exports = {
  renderQuarantinePage
};
