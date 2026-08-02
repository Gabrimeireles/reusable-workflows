// Second minimal test-only plugin — defaults the SAME field as fixture-plugin, to test that
// when both are declared, the later-declared one wins for anything the caller left unset.
export default {
  name: "fixture-plugin-2",
  defaults: {
    database: {
      containerUser: "fixture-2-default-user",
    },
  },
};
