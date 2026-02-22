function renderLandingPage() {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>One Piece (Jipi) - Stremio Addon</title>
    <style>
        body { margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: linear-gradient(rgba(0,0,0,0.6), rgba(0,0,0,0.6)), url('https://dl.strem.io/addon-background.jpg') no-repeat center center fixed; background-size: cover; color: white; display: flex; justify-content: center; align-items: center; height: 100vh; text-align: center; }
        .container { background: rgba(0, 0, 0, 0.8); padding: 3rem; border-radius: 15px; max-width: 500px; width: 90%; box-shadow: 0 10px 30px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1); }
        h1 { margin-top: 0; margin-bottom: 1rem; font-size: 2.5rem; }
        p { margin-bottom: 2.5rem; opacity: 0.9; font-size: 1.1rem; line-height: 1.6; }
        .install-btn { display: inline-block; background-color: #8A5BB8; color: white; padding: 1.2rem 2.5rem; text-decoration: none; font-weight: bold; border-radius: 8px; margin-bottom: 1.5rem; transition: transform 0.2s, background 0.3s; font-size: 1.2rem; letter-spacing: 1px; }
        .install-btn:hover { background-color: #7a4ba8; transform: scale(1.05); }
        .manifest-link { display: block; color: #aaa; text-decoration: none; font-size: 0.9rem; transition: color 0.3s; }
        .manifest-link:hover { color: #fff; text-decoration: underline; }
        .nav-links { margin-top: 2rem; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 1rem; }
        .nav-links a { color: #8A5BB8; text-decoration: none; margin: 0 10px; font-size: 0.8rem; }
    </style>
</head>
<body>
    <div class="container">
        <h1>One Piece (Jipi)</h1>
        <p>Streams resolved via Broker (B) and Worker (C)</p>
        <a href="stremio://add-jipi.vercel.app/manifest.json" class="install-btn">INSTALL ADDON</a>
        <a href="https://add-jipi.vercel.app/manifest.json" class="manifest-link">Manual Manifest Link</a>
        <div class="nav-links">
            <a href="/health">Health Check</a>
            <a href="/quarantine">Quarantine Logs</a>
        </div>
    </div>
    <script>
      window.si = window.si || function(){(window.si.q=window.si.q||[]).push(arguments)};
    </script>
    <script defer src="/_vercel/speed-insights/script.js"></script>
</body>
</html>
  `.trim();
}

function projectPublicHealth() {
  return { status: "OK" };
}

module.exports = {
  renderLandingPage,
  projectPublicHealth
};
