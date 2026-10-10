// SwipeApply service worker: shows browser push messages (lib/push.ts) and opens the right page when one is tapped.
// It does nothing else (no caching), so the app behaves exactly as without it.
self.addEventListener("push", (event) => {
  let message = { title: "SwipeApply", body: "", url: "/feed", tag: "swipeapply" };
  try {
    message = { ...message, ...event.data.json() };
  } catch {
    // A push with no readable body still shows the default message.
  }
  event.waitUntil(
    self.registration.showNotification(message.title, { body: message.body, tag: message.tag, data: { url: message.url }, icon: "/favicon.ico" }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/feed", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => client.url.startsWith(self.location.origin));
      if (open) return open.navigate(url).then((client) => (client || open).focus());
      return self.clients.openWindow(url);
    }),
  );
});
