// The worker opens a browser on whatever address an application points at. Job feeds are outside input, so it only
// opens addresses that belong to the ATS the job claims to be on (or, for the mock form, this app's own page).

const HOSTS: Record<string, RegExp> = {
  greenhouse: /^(job-boards|boards)(\.eu)?\.greenhouse\.io$/i,
  lever: /^jobs(\.eu)?\.lever\.co$/i,
  ashby: /^jobs\.ashbyhq\.com$/i,
};

function appHosts() {
  const hosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  try {
    if (process.env.APP_URL) hosts.add(new URL(process.env.APP_URL).hostname.toLowerCase());
  } catch {
    // An unparseable APP_URL adds nothing.
  }
  return hosts;
}

export function formUrlAllowed(rawUrl: string, source: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (source === "mock") {
    return (url.protocol === "http:" || url.protocol === "https:") && appHosts().has(url.hostname.toLowerCase()) && url.pathname.replace(/\/$/, "") === "/mock/greenhouse";
  }
  const pattern = HOSTS[source];
  return Boolean(pattern) && url.protocol === "https:" && pattern.test(url.hostname) && (url.port === "" || url.port === "443");
}
