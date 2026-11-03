# GitHub deployment

The public site is https://idavidkas.github.io/good-discoveries/ . Pages source: GitHub Actions.

The Pages workflow runs tests, builds public assets, fetches open scholarly metadata and external RSS, and deploys the resulting snapshot. It runs on main changes, manual dispatch and approximately every 30 minutes (GitHub scheduling can be delayed).

Sources: Crossref, Europe PMC, Nature RSS, Nature Physics RSS, Science Advances RSS. No API key is required. The result is public/feed.json; no writable database or API server is needed for this discovery workflow. Partial source failures are recorded. If every source is unavailable, deployment fails and the previously published snapshot remains online.

static/researched-feed.json contains the five source-reviewed Russian stories with review dates, primary-source links and limitations. Automated discovery appears only in the science radar, labelled as awaiting editorial review. Add a researched story to that file after reviewing the primary paper; discovery metadata is not independent replication or an endorsement of a result. Future-dated and clearly labelled correction/retraction items are excluded; these basic filters cannot detect all publication problems.

The interface opens directly with the main story. Browser refreshes read feed.json without a stale app-shell cache. The service worker retains a researched snapshot for offline use.

For real Web Push and editorial API functionality, deploy FastAPI separately on an HTTPS host with persistent SQLite storage and persistent VAPID secrets. Set FRONTEND_ORIGINS=https://idavidkas.github.io and repository Actions variable API_BASE_URL to the backend HTTPS origin, then redeploy. Never commit .env, database files, admin tokens or private VAPID keys. Real browser subscription, delivery and 72-hour scheduling still require end-to-end verification. Publishing Pages does not enable push.