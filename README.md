# Cross Stitch PWA v1.2 fixed

Оновлений пакет для GitHub Pages / Android.

## Основні фікси
- окрема кнопка `Обрати фото`
- стабільніший file picker на Android
- прибрано примусовий `capture`
- логіка завантаження через `URL.createObjectURL`
- оновлений service worker cache key
- `app.js?v=1.2` для простішого обходу кешу

## Як оновити в GitHub
1. Замінити файли в корені repo.
2. Зачекати 20–60 секунд.
3. Відкрити сайт як:
   `https://alartsp.github.io/Cross-stitch/?v=12`
4. Якщо був встановлений старий PWA — краще видалити його і відкрити сайт заново.
