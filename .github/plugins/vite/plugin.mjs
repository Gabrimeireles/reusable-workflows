// Vite (preview/static serving): a conventional HTTP health check on Vite's default preview
// port. Assumes a Compose service named `web` — override `healthChecks` entirely in the
// caller's config if that doesn't match. (This is the exact convention Pricely's own web health
// check already used in iteration 1 — see tests/fixtures/config/valid/pricely-homolog.yml —
// generalized here into a reusable default.)
export default {
  name: "vite",
  defaults: {
    healthChecks: [
      {
        name: "web",
        type: "compose",
        service: "web",
        command: "wget -qO- http://127.0.0.1:5173",
        retries: 30,
        intervalSeconds: 5,
      },
    ],
  },
};
