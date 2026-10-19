export const env = {
  DB: null,
  SETUP_CODE: "INITIAL_SETUP_SECRET_2026",
};

export function setTestDb(database) {
  env.DB = database;
}
