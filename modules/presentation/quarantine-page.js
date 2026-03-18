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
  const resolutionErrors = Number(input.resolutionErrors || 0);

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
      <td>${event.time}</td>
      <td>${event.ip}</td>
      <td>${event.episodeId}</td>
      <td class="error-cell">${event.error}</td>
    </tr>
  `).join("");

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Quarantine Events</title>
        <style>
          * { box-sizing: border-box; }
          body {
            margin: 0;
            min-height: 100dvh;
            background: #1a1a1a;
            color: #eee;
            font-family: sans-serif;
            padding: clamp(0.9rem, 3vw, 2rem);
          }
          .page {
            width: min(100%, 1024px);
            margin: 0 auto;
          }
          h2 {
            margin: 0 0 0.75rem 0;
            font-size: clamp(1.1rem, 3.4vw, 1.6rem);
          }
          .stats {
            margin: 0 0 0.9rem 0;
            line-height: 1.5;
            overflow-wrap: anywhere;
          }
          .table-wrap {
            overflow-x: auto;
            border: 1px solid #3d3d3d;
            border-radius: 10px;
            background: #2a2a2a;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            min-width: 560px;
          }
          th,
          td {
            padding: 8px;
            border-bottom: 1px solid #444;
            text-align: left;
            vertical-align: top;
            overflow-wrap: anywhere;
            word-break: break-word;
          }
          thead tr {
            background: #333;
          }
          .error-cell {
            color: #ff6b6b;
          }
          .empty-row {
            padding: 20px;
            text-align: center;
          }
          .back-link {
            display: inline-block;
            margin-top: 0.85rem;
            color: #8a5bb8;
          }
          @media (max-width: 640px) {
            table {
              min-width: 100%;
            }
            th,
            td {
              font-size: 0.86rem;
            }
          }
        </style>
      </head>
      <body>
        <main class="page">
          <h2>Quarantine Events (Last 50)</h2>
          <p class="stats"><b>Stats:</b> Active Sessions: ${activeCount}/${maxSessions} | Slot Taken Blocks: ${slotTaken} | Resolution Errors: ${resolutionErrors}</p>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>IP</th>
                  <th>Episode</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>${rows || "<tr><td colspan='4' class='empty-row'>No events</td></tr>"}</tbody>
            </table>
          </div>
          <a href="/" class="back-link">Back to Home</a>
        </main>
      </body>
    </html>
  `;
}

module.exports = {
  renderQuarantinePage
};
