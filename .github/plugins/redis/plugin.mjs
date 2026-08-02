// Redis: no configuration a generic plugin can usefully default beyond "start it as a
// dependency service before the app" — the compose service is assumed to be named `redis`
// (the caller's Compose file must declare a service with that name; override
// compose.dependencyServices explicitly if it's named differently).
export default {
  name: "redis",
  defaults: {
    compose: {
      dependencyServices: ["redis"],
    },
  },
};
