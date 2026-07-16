import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Daily Chicago apartment search — runs in Convex's cloud, no local machine.
// 12:00 UTC = 8:00 AM Chicago (CDT). Finds new listings and imports them.
crons.daily(
  "daily apartment search",
  { hourUTC: 12, minuteUTC: 0 },
  internal.dailySearch.run,
  {},
);

export default crons;
