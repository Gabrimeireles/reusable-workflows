// Next.js: a conventional HTTP health check against the default Next.js port. Assumes a
// Compose service named `web` — override `healthChecks` entirely in the caller's config if
// that doesn't match.
export default {
  name: "nextjs",
  defaults: {
    healthChecks: [
      {
        name: "web",
        type: "compose",
        service: "web",
        command: "wget -qO- http://127.0.0.1:3000",
        retries: 20,
        intervalSeconds: 5,
      },
    ],
  },
};
