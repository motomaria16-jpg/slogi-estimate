# SLOGI v76.1.3 — Shared Workspace Purge Hotfix

- Исправлен permanent purge объекта из «Корзины»: trash-authorized ID теперь физически удаляется и из `slogi_locations_v1`.
- Обычное удаление по-прежнему является recoverable soft-delete.
- Активный объект нельзя удалить через purge, пока его ID не находится в корзине.
- Добавлена атомарная клиентская операция purge-all для всех объектов корзины; активные объекты сохраняются.
- Shared workspace получает итоговый `locations + professional state` через существующий revision-based CAS.
- При `PT409` сохраняются conflict draft и remote winner; автоматического retry flood нет.
- Добавлены regression tests для soft-delete, purge-one, purge-all, reload/cross-session и отсутствия resurrection.
- Migrations, Edge Functions, Auth/JWT, Cian parser, Browserless, Avito/Ozon, Vault и cron не изменялись.

Production cleanup, который выявил дефект, не является доказательством исправления. Исправление подтверждается только локальными unit/integration tests и опубликованными immutable Git artifacts.
