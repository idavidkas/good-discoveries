# GitHub deployment

The Pages workflow tests the backend, builds only the public frontend, and deploys it using GitHub Actions. In repository Settings > Pages choose GitHub Actions as the source.

Without repository variable API_BASE_URL, the site explicitly shows the demo feed. Push delivery is not enabled by publishing Pages.

Deploy the FastAPI backend separately on an HTTPS host with persistent SQLite storage and persistent VAPID secrets. Set FRONTEND_ORIGINS=https://idavidkas.github.io and configure API_BASE_URL to the backend HTTPS origin in repository Actions variables. Re-run the Pages workflow after changing it.

Never commit .env, database files, admin tokens or private VAPID keys. Use the supplied .env.example and production compose files as templates. Verify health, CORS, browser subscription, real notification delivery and 72-hour scheduling before claiming notifications work.
