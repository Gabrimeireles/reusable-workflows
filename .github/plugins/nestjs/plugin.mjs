// NestJS: a conventional HTTP health check. Assumes a Compose service named `backend` exposing
// `/health` — override `healthChecks` entirely in the caller's config if that doesn't match.
export default {
  name: "nestjs",
  defaults: {
    healthChecks: [
      {
        name: "backend",
        type: "compose",
        service: "backend",
        command: "wget -qO- http://127.0.0.1:3000/health",
        retries: 15,
        intervalSeconds: 5,
      },
    ],
  },
};
