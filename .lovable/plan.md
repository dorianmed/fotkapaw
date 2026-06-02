## Cel

Przebudowa narzędzi geodezyjnych w stylu QGIS: panel po prawej stronie z zakładkami **Rysowanie / Pomiar GPS / Eksport**, narzędzie zaznaczania (strzałka + ogrodzenie/fence) na mapie, oraz wybór układu współrzędnych (domyślnie PUWG 1992) przy tworzeniu warstw, pomiarze i eksporcie.

## Co zostaje bez zmian
Lewy panel (import zdjęć, warstwy wektorowe KML/DXF/SHP, pomiary na mapie, podkład, statystyki) działa jak teraz. Logika obliczeń pokrycia / GSD nie jest ruszana.

---

## 0. Narzędzie zaznaczania (strzałka + fence)

- Nowy przycisk-strzałka w pasku narzędzi nad mapą (góra-prawo, obok zoomu).
- Tryb „Zaznacz”:
  - **Klik** na obiekt rysowany → zaznacza pojedynczy obiekt.
  - **Przeciągnięcie** po pustej mapie → rysuje prostokąt (fence) i zaznacza wszystkie obiekty rysowane, których wierzchołki mieszczą się w prostokącie.
- Zaznaczone obiekty podświetlane (gruba obwódka / kolor akcentu). Stan zaznaczenia to zbiór `{layerId, featureId}` (wiele obiektów).
- Klik w puste miejsce (bez przeciągania) czyści zaznaczenie.

## 1. Panel narzędzi po prawej

- Nowy panel po **prawej** stronie ekranu z zakładkami (`Tabs`): **Rysowanie**, **Pomiar GPS**, **Eksport**.
- Desktop: panel zadokowany po prawej. Mobile: chowany, otwierany ikoną „trzy kreski” w prawym górnym rogu (analogicznie do obecnej lewej szuflady).

## 2. Zakładka Rysowanie (jak QGIS)

- Przycisk „Dodaj warstwę” → mały formularz: **nazwa** (np. „drzewo”), **geometria** (punktowa / liniowa / powierzchniowa), **układ współrzędnych** (domyślnie PUWG 1992).
- Po utworzeniu warstwa staje się aktywna i można rysować klikając po mapie (istniejąca logika rysowania).
- Lista warstw: aktywacja, widoczność, kolor, zmiana nazwy, usuwanie, licznik obiektów (bez rozwijania każdej linii osobno — jak teraz).
- Układ zapisany na warstwie służy jako domyślny przy eksporcie.

## 3. Zakładka Pomiar GPS

- Przycisk „Pomierz” korzysta z `navigator.geolocation` (GPS urządzenia).
- Wybór warstwy docelowej: istniejąca (z listy) lub nowa (nazwa wpisywana ręcznie).
  - Jeśli wybrano istniejącą → typ geometrii pobierany automatycznie.
  - Jeśli nowa → wybór typu geometrii.
- Wybór układu współrzędnych (domyślnie PUWG 1992).
- Punktowa: jeden odczyt GPS = jeden punkt. Liniowa/powierzchniowa: przycisk „Dodaj punkt” dokłada kolejne odczyty, „Zakończ” tworzy obiekt.
- Pokazywana bieżąca dokładność/pozycja GPS.

## 4. Zakładka Eksport (na dole panelu)

- Lista warstw rysowanych z **checkboxami** (wybór wielu do eksportu).
- Wybór układu eksportu: **WGS84 / PUWG 1992 / PUWG 2000** (domyślnie WGS84 / EPSG:4326).
- Zakres eksportu: **cała warstwa** albo **tylko zaznaczone obiekty** (z narzędzia z pkt 0).
- Format: KML / DXF / GeoJSON / TXT. Eksport każdej wybranej warstwy do osobnego pliku.

---

## Szczegóły techniczne

- `src/types/drawing.ts`: dodać pole `crs: CoordinateSystem` do `DrawingLayer`.
- `src/pages/Index.tsx`:
  - stan zaznaczenia wielu obiektów `selectedFeatures: {layerId, featureId}[]` (obok obecnego pojedynczego `selectedFeature`).
  - tryb mapy: dodać `"select"` do trybów interakcji; obsługa fence (mousedown/move/up) przekazana do `MapView`.
  - `handleAddDrawLayer` przyjmuje `{name, type, crs}`.
  - GPS: handler odczytu pozycji i dokładania do aktywnego/wybranego layera.
  - `handleExportDrawLayer` rozszerzony o eksport wielu warstw i zakres „zaznaczone” (lista featureId).
- `src/components/MapView.tsx`:
  - obsługa trybu zaznaczania: klik na feature → toggle, drag → prostokąt fence → zaznaczenie obiektów w prostokącie; podświetlenie zaznaczonych.
  - wyłączyć rysowanie/pomiar gdy aktywny tryb select.
- Nowy komponent `src/components/ToolsPanel.tsx` (prawy panel z `Tabs`: Rysowanie / Pomiar GPS / Eksport). Część logiki warstw przeniesiona z `Sidebar.tsx` do tej zakładki.
- Pasek narzędzi mapy: przycisk strzałki (select) + ewentualnie przełączniki trybu.

## Weryfikacja
- Build przechodzi.
- Klik vs. przeciągnięcie zaznacza poprawnie (pojedynczo / fence).
- Tworzenie warstwy z CRS, rysowanie, pomiar GPS (w przeglądarce z dostępem do lokalizacji), eksport wybranych warstw w wybranym układzie i zakresie.
