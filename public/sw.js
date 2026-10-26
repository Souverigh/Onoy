// Depter: только push-уведомления (src/lib/push.ts). Страницы и данные НЕ
// кешируются — обработчика fetch нет намеренно: устаревшие суммы долгов
// хуже, чем загрузка из сети (см. src/app/manifest.ts).

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Depter", {
      body: data.body || "",
      icon: "/icons/192",
      badge: "/icons/192",
      // Один заказ — одно уведомление, даже если пришло дважды.
      tag: data.tag || undefined,
      data: { url: data.url || "/" },
    }),
  );
});

// Нажали на уведомление — открыть нужный раздел в уже открытом Depter или новом окне.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if ("navigate" in client) await client.navigate(url);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
