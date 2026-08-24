# SLOGI v76.1.1

Hotfix не меняет production Supabase, Cian parser transport, frozen baseline или forward migrations.

- «Предложения ЦИАН» переименовано в «Поиск помещений»; прежний объектный список — в «Мои помещения».
- Четыре product-раздела собраны в одну компактную общую шапку.
- Все активные страницы подключены к централизованному visual layer.
- Свободный адресный фильтр заменён каноническим select кластеров.
- На карту добавлены polygon overlays из существующей SLOGI geometry; filter/list/map синхронизированы.
- Карточка ЦИАН добавляет объект через существующий `Phase0Service`, сохраняет его в shared workspace и блокирует дубли.
- «Мои помещения» показывает источник, кластер, площадь, аренду, статус и дату добавления.
- Клиент shared workspace распознаёт SQLSTATE `40001` даже при HTTP 500 от PostgREST и явно разрешает revision conflict.
- Исправлено совместное отображение loading/empty state при уже загруженной карточке.
- Avito/Ozon runtime, Browserless flow, Auth/JWT, расчёты и production configuration не изменялись.
