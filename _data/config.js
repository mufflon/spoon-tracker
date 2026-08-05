// Public config baked into the page. The API base is the Worker URL — not a
// secret. Override at build time with SPOON_API if you rename the Worker.
export default {
  apiBase: process.env.SPOON_API || "https://spoon-tracker.mufflon.workers.dev"
};
