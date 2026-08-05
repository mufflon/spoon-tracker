// Build timestamp -> versions the service-worker cache, so each deploy replaces
// the old offline cache and never serves a stale app.
export default { time: new Date().toISOString().replace(/[:.]/g, "-") };
