# Animation Studio — offline Android + PC

Самостоятельное приложение для создания и правки скелетных анимаций персонажей, отдельно от Rig & Weapon Studio.

Первая версия: импорт GLB/GLTF/FBX, выбор костей, редактирование вращений по осям X/Y/Z, ключевые кадры на шкале 30 FPS, воспроизведение и экспорт GLB с анимациями. Управление адаптировано для планшета; модели обрабатываются локально. Выбор папки при сохранении Android реализован через Storage Access Framework.

## Запуск на компьютере

```bash
npm install
npm run test
npm run dev
```

Production web build: `npm run build`.

## Android APK

GitHub: **Actions → Build Animation Studio APK → Artifacts → Animation-Studio-APK**. Workflow автоматически генерирует Android-проект через Capacitor; готовый `app-debug.apk` находится в артефакте сборки. Нужен GitHub Actions (онлайн) для сборки, но программа работает локально без серверной обработки моделей.

## Принцип ключей

30 кадров/с. Можно создать новую анимацию или открыть исходную анимацию модели и добавить/заменить ключевые кадры выбранных костей. Исходные анимационные треки, не затронутые редактированием, сохраняются. Полный ключ позы записывает повороты всех костей. Воспроизведение между ключами интерполирует кватернионы. Поддерживается просмотр в цикле, смена длительности и сброс внесённых ключей.

## Ограничения MVP

Пока вращение костей только через числовые поля и ползунки; IK, редактирование весов, точная продвинутая кривая ускорений, движение корня и экспорт FBX ещё не реализованы. Исходные нестандартные форматы анимаций могут потребовать конвертации в GLB. Для корректного экспорта исходная модель должна содержать настоящий скелет. Сохранение файлов выполняется на устройстве.
## Просмотр моделей без скелета (v0.2)

GLB/GLTF/FBX без костей теперь загружаются в 3D-просмотр без ошибки. Можно рассмотреть геометрию и материалы, управлять камерой и сохранить обычный GLB. При этом программа показывает режим «без скелета», а запись ключей суставов отключена. **Автоматическое добавление Mixamo-скелета и skin weights пока не реализовано** — для этого нужен отдельный этап риггинга.

## AutoRig — этап 1: подгонка шаблонного скелета (v0.3)

Для модели **без существующего скелета** появляется раздел «AutoRig · подгонка скелета». Нажми «Добавить скелет»: на основе габаритов модели приложение создаёт независимый 22-суставный гуманоидный шаблон **с именами костей, похожими на Mixamo**. Первая расстановка приблизительная (A-стойка), она не распознаёт анатомию компьютерным зрением. Можно выбирать сустав из списка или касанием цветного маркера на модели и точно перемещать в 3D-манипуляторе или координатами X/Y/Z. Сброс и удаление шаблона не изменяют исходную модель. «Сохранить подгонку JSON» сохраняет позиции всех суставов с указанием модели.

**ВАЖНО:** шаблон специально не считается готовым ригом: skin weights, SkinnedMesh и настоящее управление геометрией ещё не созданы. Поэтому при сохранении обычного GLB с исходной моделью шаблон не выдаётся за работающий скелет и его надо сохранять отдельно в `*_rigfit.json`. Следующий этап — расчёт весов, связывание мешей с костями и проверка сгибов. На моделях с существующим скелетом добавление второго шаблона отключено.

Сборка и тесты: `npm test` запускает как тесты анимационных ключей, так и проверку структуры шаблона, переноса суставов и JSON.

## Подгонка суставов пальцем и общий масштаб (v0.4)

В режиме AutoRig теперь можно **коснуться цветной точки на 3D-модели и перетащить её пальцем**, без микроскопических стрелок. Перемещение идёт по плоскости, обращённой к камере, на глубине выбранного сустава. Для точной настройки сначала включай **«Спереди»** (ширина/высота), затем **«Сбоку»** (глубина/высота). Отдельный переключатель включает прежние стрелки манипулятора; ввод координат X/Y/Z остаётся. Выбор «ВЕСЬ СКЕЛЕТ» даёт сдвиг всего шаблона; ползунок масштаба 50–175% подгоняет рост целиком. Суставы и линии рисуются поверх исходного меша для лучшей видимости.

**Подгонка не является привязкой к сетке.** Геометрию не деформируем, веса не считаем; прежний экспорт GLB сохраняет исходную модель, а текущий шаблон — отдельным JSON. Поворот камеры и масштаб двумя пальцами доступен при касании пустой области.

## AutoRig — дополнительные цепочки костей (этап 1B)

В разделе «Дополнительные кости» можно создать независимую цепочку для **хвоста, правого/левого уха, крыла, пряди волос или щупальца**. Выбери тип, установи от 2 до 12 костей, затем нажми «Добавить цепочку». Новые кости действительно прикрепляются к нужной кости иерархии шаблона: хвост к тазу, уши и волосы к голове, крылья к груди. Можно добавить несколько отдельных цепочек одного типа, у каждой будут уникальные имена и отдельный сброс/удаление.

Все кости доступны в общем выпадающем списке, в 3D-маркерах и в точных координатах X/Y/Z. При сохранении `*_rigfit.json` добавляются также цепочки и позиции их суставов. Основная модель и её материалы остаются без изменений.

**Важное ограничение:** это система подгонки костей, а не автоматический скиннинг. Кости дополнительных цепочек не заставят геометрию двигаться, пока для соответствующего хвоста/крыльев не созданы и не проверены веса вершин. Импорт готовых ригов и обычный редактор анимаций не менялись.

## AutoRig geometry-based first pass

AutoRig no longer uses only overall Box3 bounds to position the central spine. On selecting `Добавить скелет` the editor samples the *actual loaded mesh vertices* (bounded to approximately 36,000 points for weak Android devices), isolates central torso-height geometry, and estimates the near-front surface and an inward offset. This avoids placing the spine in back hair, a cape, or a backpack, as seen in the user's test video. It also estimates width from the body's vertex cross-section rather than blindly using total hair/shield spread.

Different GLB/FBX characters can face +Z, -Z, +X or -X. Use **Направление персонажа** and **Пересчитать скелет по модели** if the guessed front is incorrect. This explicitly overwrites previous manual main-skeleton fitting with user confirmation; extra chains remain attached.

The torso approximation is *not automatic anatomy recognition*. It is a more reliable starting location. Shoulder, knee and wrist positions still need manual review, especially on non-standard outfits. The original mesh is unchanged and skin weights are still not generated.

## Snap joint to actual geometry (v0.6)

For precise manual correction after torso fitting, select a joint, press **Поставить сустав касанием тела**, then tap the target elbow/knee/shoulder on the 3D model. The app raycasts against the model's mesh surfaces, calculates a point slightly inside the first surface hit and moves the selected skeleton joint there. Small body parts use a shallower inset. This avoids having to scroll and manually enter world coordinates for every joint. The interaction automatically exits after a valid mesh hit; pressing the same button cancels it. It does not estimate skin weights.

## Официальная иконка лаунчера

Android Launcher теперь использует утверждённый дизайн из второго концепта: неоновая карточка с сурикатом, надписью ANIMATION STUDIO и цианово-пурпурной рамкой. В репозитории хранится оптимизированный локальный WebP (`branding/android/animation_icon.webp`), который GitHub Actions устанавливает как адаптивную и обычную круглую/квадратную иконку. Старые стандартные значки Capacitor удаляются перед сборкой APK. Favicon веб-редактора соответствует иконке приложения.

## AutoSkin — first beta (APK after v8)

A new **ПРИВЯЗАТЬ МОДЕЛЬ К СКЕЛЕТУ** button creates four normalized influence weights per vertex based on distance to fitted bone segments. A real `THREE.SkinnedMesh` replaces each mesh while retaining material, transform and name; bind inverse matrices are captured and the skeleton hierarchy, including manually added tail/ear/wing bones, is attached to the model's GLB scene. You may preview skeletal rotations, animate with existing timeline controls and export rigged GLB. Export with no animation saves a skinned rest-pose GLB.

**WARNING:** this is a first-pass automatic skinning algorithm, not a Mixamo-quality solver. Complex armor, skirts, hair and tails can stretch unexpectedly; verify bone rotations and mesh motion in the editor. Limit: 450,000 vertices. Do not replace original model with a beta output.

Before pressing Bind, save your fitted coordinates in the portable JSON format. **Загрузить подгонку JSON** loads that file later (including extra chains), and **Черновик подгонки** restores a per-model locally stored draft from this version onward. The older APK v8 did not autosave drafts; if the model was closed without JSON, the previous fitting cannot be reconstructed from the static GLB.

## Large characters: chunked AutoSkin (v12)

Removed the old fixed 450,000-vertex rejection. A 730,338-vertex character like the one in the test video can now be processed in batches of 8192 vertices, with UI progress updates. Original position/normal/UV/morph buffers are shared in the new skinned geometry instead of duplicating all of them; 4 indices + 4 float32 weights add about **24 bytes/vertex** (approximately 16.7 MiB for 730,338 vertices). Mobile memory protection now uses a budget of 80 MiB of *additional skin buffers*, which allows over 3 million vertices but may still need optimization for other memory-heavy models. This is not a promise that any model size will work on any tablet.

The AutoSkin process yields to the UI between chunks; exceptions/cancellation preserve the original mesh and fitted skeleton. Automated regression tests include the 730,338-vertex scenario, cancellation and budget guards. This does not guarantee high-quality deformation on monsters, fur, heavy armor or separated clothing parts.

## FBX Export (v14 beta)

New second button **СОХРАНИТЬ FBX** creates a *real binary FBX 7.4 / 2014–2015* on device, using the MIT-licensed `@comfyorg/fbx-exporter-three` dependency. The module is loaded only on demand; other editing workflows keep the FBX library out of the initial bundle. Input formats remain GLB/GLTF/FBX, preferred output GLB or FBX. The exporter receives the model tree, bones, skin weights, textures and all source animation clips plus the edited timeline clip, and uses a Blender-compatible preset. Android uses NativeFileSaver, streaming binary bytes in 96KB Base64 chunks through SAF. Browser Save File Picker also supports `.fbx`; a binary `Uint8Array` is passed directly, without converting bytes to text. Large-scene export warns about extra memory consumption.

**Compatibility limit:** this first implementation exports FBX 7.4 (FBX 2014/2015), not 7.3 (FBX 2013). If an older Mixamo uploader requires FBX 2013 or earlier, these outputs may be rejected. Blender and compatible editors can be tried first; FBX 2013 export remains a separate feature. Reimporting into specific programs and fidelity of armored models still require real-device testing.

## Tail-specific weight editor — beta (post-v14)

Experimental and opt-in **Веса хвоста** panel after AutoSkin. It does not rerun body AutoSkin. The user chooses a SkinnedMesh (prefer an explicitly named tail mesh), selects an existing Tail_01..Tail_05 chain, sets an influence radius of 1–15% of character height and can **inspect affected vertex count before applying**. The algorithm works inside a tube around the chosen tail bones, preserves original pelvic influences at the tail root, blends influences between adjacent tail bones, and leaves all nonselected mesh geometries unchanged. It keeps original per-mesh skin attribute objects for an immediate one-click **Undo**; recalculations use the original attributes rather than accumulating changes. The renderer can temporarily wag the tail as a visual test, then restore its original bone rotations without creating animation keys.

When a model is one giant mesh, radius selection is only an approximation and may capture nearby armor, clothes or pelvis vertices. Start at 3–5% and verify the affected count. This is a beta geometry-proximity tool, not automatic semantic recognition of an animal tail. Always retain an original GLB and portable rig-fit JSON. Export after finalizing results through GLB or FBX.
