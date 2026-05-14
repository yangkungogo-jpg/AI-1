const { PrismaLibSQL } = require("@prisma/adapter-libsql");
const { createClient } = require("@libsql/client");

module.exports = {
  earlyAccess: true,
  migrate: {
    adapter: async () => {
      const client = createClient({ url: "file:./prisma/dev.db" });
      return new PrismaLibSQL(client);
    },
  },
};
