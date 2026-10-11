# FactorEdge Case: Karar Günlüğü ve README Ham Notları

> Bu dosya README için **ham malzemedir**. README'yi kendi cümlelerinle yazarken buradan seç.
> Repoda `docs/notes.md` olarak tut. Yeni bir Cursor sohbetine başlarken `@docs/notes.md` ile bağlam olarak ver.
> "(doğrula)" işaretli yerleri koda bakarak teyit et.

---

## 0. Durum (11 Ekim 2026)

- Zorunlu kapsamın beş maddesi çalışıyor: panel, geçmiş, cihaz yönetimi, kullanıcı/rol, kesinti davranışı.
- Tur 1–3 elle test edildi. Bulunan sorunlar düzeltildi.
- Kalanlar: son değişikliklerin commit'i, README, demo provası, "hazırım" e-postası. Son gün yaklaşık 13 Ekim.

---

## 1. Bileşenler ve çalışma ortamı

**Mac (host), `platform/`:**
- Postgres 17: docker compose, sadece `127.0.0.1:5432`
- Backend: NestJS 11, `:3000`, prefix `/api`
- Frontend: Vite + React + Mantine, `:5173`. `/api` istekleri Vite proxy ile backend'e gider (aynı origin, cookie ve SSE sorunsuz)

**VM:** Multipass, Ubuntu 24.04, adı `factory`, IP `192.168.252.2`
- Repo `~/projects/factoredge` → VM'de `/home/ubuntu/factoredge` olarak mount
- `vm/docker-compose.yml`:
  - `mosquitto`: `:1883`
  - `line1-sim`: Modbus TCP `:5020`, unit 1
  - `line2-sim`: MQTT, prefix `factory/line2`

**Veri akışı:**
simülatör → (Modbus poll / MQTT subscribe) → connector → `TelemetrySample` → telemetry (DB + son değer + realtime) ve device-health → SSE `/api/stream` → React (TanStack Query cache)

---

## 2. Kurulum taslağı (doğrula)

**VM:**
```bash
multipass launch 24.04 --name factory --cpus 2 --memory 4G --disk 20G
multipass mount ~/projects/factoredge factory:/home/ubuntu/factoredge
multipass shell factory
# VM içinde: Docker kurulumu (get.docker.com), kullanıcıyı docker grubuna ekle
sudo timedatectl set-ntp true
cd ~/factoredge/vm && docker compose up -d --build
```

**Platform (Mac):**
```bash
cd platform && cp .env.example .env    # değerleri doldur, JWT_SECRET: openssl rand -base64 48
docker compose up -d
cd backend && npm install && npm run db:migrate && npm run db:seed && npm run start:dev
cd ../frontend && npm install && npm run dev    # http://localhost:5173
```

**Testler:**
- Backend: `npm test`, `npm run test:e2e`
- Frontend: `npm test`
- Simülatörler (`vm/simulators`): `npm test`

---

## 3. Veri modeli

**`devices`:** id, name (unique), protocol (MODBUS | MQTT), config (jsonb, zod ile doğrulanır), enabled, createdAt, updatedAt

**`readings`:**
- device_id (FK, cascade)
- ts (ölçüm anı), received_at (platformun aldığı an)
- production_count (bigint), scrap_count (bigint)
- motor_temp_c (double), motor_current_a (double)
- state (RUNNING | STOPPED | FAULT)
- Birincil anahtar: (device_id, ts)

**`users`:** id, username (unique), password_hash, role (ADMIN | VIEWER)

**`events`:** şemada var, kullanılmıyor

**Canlı durum (bellekte, DB'de değil):** connection, connectedAt, lastSeenAt (= receivedAt), lastError, status (CONNECTING | ONLINE | STALE | OFFLINE | DISABLED)

**Ortak model (`TelemetrySample`):** ts, productionCount, scrapCount, motorTempC, motorCurrentA, state

**Sayaçların `bigint` olmasının sebebi:** Modbus uint32 en fazla ~4,29 milyar, Postgres `integer` ~2,1 milyarda taşar.

---

## 4. MQTT topic şeması

| Topic | Ne | Ayrıntı |
|---|---|---|
| `factory/line2/telemetry` | Her saniye, QoS 1 | `{"ts":"<ISO UTC>","seq":n,"state":"running\|stopped\|fault","productionCount":n,"motorTempC":n,"motorCurrentA":n,"scrapCount":n}` |
| `factory/line2/status` | `online` / `offline`, retained | Last Will = `offline`. Temiz kapanışta simülatör `offline`'ı kendisi yayınlar, çünkü temiz DISCONNECT'te broker LWT'yi yayınlamaz. |
| `factory/line2/command` | Demo kontrolü | `{"setState":"running\|stopped\|fault"}` |
| `factory/desk1/operator` | Kamera için ayrılan yer | `{"ts":"...","class":"normal\|tired\|absent"}` |

- **`seq`:** Her süreç başlangıcında 1'den başlar. Düşmesi = simülatör yeniden başladı. Bağlantı yokken yayın yapılmaz, `seq` artmaz.
- **`ts`:** Kesinti süresini `ts` aralığı gösterir. `seq` broker yolundaki kaybı yakalar.
- **Birimler alan adında** (`motorTempC`, `motorCurrentA`).
- **Tek mesajda tüm sinyaller:** değerler aynı anın fotoğrafı.
- Platform şu an `status` / LWT topic'ini **dinlemiyor** (bkz. bölüm 8).

---

## 5. Önemli kararlar

★ = README'deki "en önemli üç karar" için adaylar

**★ 1. Connector manager bir reconciliation kontrolcüsü.**
- DB istenen durumdur. Her ekleme/düzenleme/silmeden sonra, cihaz başına sıralı bir kuyrukta `reconcile(id)` çalışır: DB'yi okur ve connector'ı ona getirir.
- Eşzamanlı iki PATCH gelse bile sonunda DB'deki gerçek uygulanır, sıra sorunu yok.
- Kuyruk: cihaz başına Promise zinciri, ek kütüphane yok.
- Sink'te `active` bayrağı: `stop()`'tan önce kapanır, stop sonrası gelen callback yok sayılır (silinmiş cihaza FK hatası olmaz).
- Connector'lar Prisma'yı, SSE'yi ve cihaz id'sini bilmez. Yeni protokol = yeni connector sınıfı + zod şeması + factory'de bir `case`.

**★ 2. Tek veri modeli; protokol farkı connector'da biter; iki zaman damgası.**
- `ts` ölçüm anı, `receivedAt` platformun alış anı.
- Sağlık `receivedAt`'e göre hesaplanır.
- Bu tasarım geliştirme sırasında VM saatindeki **3,5 dakikalık kaymayı** yakaladı. Sağlık durumu etkilenmedi.

**★ 3. Yetki varsayılan olarak kapalı.**
- Global `JwtAuthGuard` + `RolesGuard`. Açık endpoint'ler `@Public()` ile açıkça işaretlenir.
- Rol her istekte DB'den okunur, token'dan değil (silinen ya da rolü düşürülen kullanıcının eski token'ı işe yaramaz).
- `passwordHash` beyaz liste `select` ile hiç çekilmez (kara liste değil).
- Login'de kullanıcı yoksa bile sahte hash ile karşılaştırma: zamanlama farkından kullanıcı adı tahmin edilemez. İki hatalı girişin yanıtı bayt bayt aynı.
- Son admin koruması: `SELECT … ORDER BY id FOR UPDATE` (kötümser kilit, sıralı kilitleme ile deadlock yok).

**Diğer kararlar:**
- **Sağlık:** bağlantı + tazelik. Eşik = beklenen aralık × 3 (Modbus `pollIntervalMs × 3`, MQTT 3 sn). İlk veri için tanınan süre var. OFFLINE'dayken gelen `connecting` durumu değiştirmez (yanıp sönme yok).
- **Modbus connector:** `setTimeout` zinciri (istekler üst üste binmez), fonksiyon kodu başına tek blok okuma, backoff 1 → 2 → 4 → 8 → 10 sn, soket `close` olayı dinleniyor.
- **Encoder ve decoder ayrı:** Simülatördeki encoder ile platformdaki decoder kod paylaşmaz. İkisi de aynı altın değer tablosuyla test edilir.
- **Register haritası arayüzde sabit 5 satır:** Arayüz imkânsız durumları (eksik ya da tekrar eden sinyal) baştan engeller, backend yine de doğrular. Derinlemesine savunma. 32 bit tiplerde `wordOrder` zorunlu.
- **Doğrulama ayrımı:** HTTP DTO'ları class-validator, dış JSON (cihaz config'i, MQTT payload) zod.
- **SSE + httpOnly cookie:** EventSource başlık ekleyemez, token'ı URL'ye koymak loglara düşürür. Cookie'yi JavaScript okuyamaz.
- **Frontend canlı veri:** Tek EventSource. Önce snapshot, sonra olaylar. Olaylar TanStack Query cache'ine saf reducer'larla yazılır, ekranlar sadece cache'i okur. Yeniden bağlanınca geçmiş yeniden çekilir, grafikteki boşluk kapanır.
- **İstemci tarafı sessizlik bekçisi:** Heartbeat 5 sn, 15 sn sessizlikte bağlantı ölü sayılır ve yeniden açılır. Karşı tarafın "kapandım" demesine güvenilmez.
- **Bağlantı canlı değilken:** Sağlık rozetleri ve değerler soluk, "son bilinen durum" olarak gösterilir.
- **Oturum olayları:**
  - Kullanıcı silinince o kullanıcının akışlarına `session-ended`
  - Rol veya parola değişince `session-changed`
  - 30 sn'lik emniyet taraması ve JWT süresi dolunca akışı kapatma
  - Sekmeler arası çıkış/giriş: `BroadcastChannel`
- **Graceful shutdown:** SSE akışları tamamlanır, boşta bağlantılar kapatılır, 3 sn sonra zorla kesilir, toplam süre 10 sn ile sınırlı.
- **Simülatörler:**
  - Ortak, protokolden bağımsız fizik modülü. Gizli yük değişkeni L sinyalleri birbirine bağlar. Sıcaklık üstel yaklaşımla değişir. Durum makinesi: çalışıyor → durdu, %15 ihtimalle arıza.
  - Sayaçlar volume'da kalıcı (PLC'nin kalıcı belleği gibi), atomik yazma (geçici dosya + rename).
  - `dt` gerçek geçen süreden ölçülür.
- **Ağ açıklığı bilinçli:** Postgres sadece `127.0.0.1`. Mosquitto ve Modbus VM'de `0.0.0.0` (dışarıdan erişilmesi gerekiyor).
- **Sürümler:** CommonJS + TypeScript 5.9 + NestJS 11 + Prisma 7.10, hepsi sabit.
- **Veritabanı:** Düz Postgres (Timescale değil, bu ölçekte gereksiz). Cihaz silinince okumalar cascade ile silinir.

---

## 6. AI aracının yanlış ya da eksik önerdiği yerler (README madde 7)

Her biri için: ne oldu → nasıl fark edildi → ne yapıldı.

1. **Jest + Prisma 7.** AI "moduleNameMapper yeterli" dedi. Deneme projesinde client oluşturulmuş ama veritabanına hiç bağlanılmamıştı. Gerçek DB'ye karşı e2e testlerin 18'i de düştü (dinamik `import()`). → `--experimental-vm-modules`. Ders: smoke test, başarısız olabilecek yolu çalıştırmalı.

2. **Son admin koruması: veri doğru, HTTP kodu yanlış.** Serializable transaction + P2034 → 409 eşlemesi kullanılmıştı, e2e testi geçiyordu. Gerçek DB'de hangi kodların döndüğünü raporlamasını istedim. 50 turluk ölçüm: 49 kez 500. Sebep: 40001 hatası COMMIT anında oluşunca Prisma onu sarmıyor. → `FOR UPDATE` + `ORDER BY id`, 50/50 doğru 409. Yeni testin eski koda karşı kırmızı olduğu doğrulandı.

3. **"SIGTERM ile kapanış hatasız".** Açık SSE istemcisi yokken denenmişti. Gerçekte Ctrl+C askıda kaldı. Sunucu yeni istekleri reddederken eski SSE bağlantısından heartbeat göndermeye devam etti, bu yüzden istemci bekçisi de durumu fark etmedi. Bir hata başka bir hata gibi göründü.

4. **Geçmiş sayfası çöküyordu** ("Maximum update depth exceeded"). Smoke test API'yi curl ile doğrulamıştı ama bileşen hiç çizilmemişti.

5. **Cihaz modalı.** "Build temiz" denmişti ama ekranda kullanılamaz durumdaydı (ezilmiş sütun, çift scroll, kesik metin). Ekran görüntüsüyle geri bildirim verdim. Sonrasında ajan kendi başsız Chrome ekran görüntülerine bakarak doğruladı.

6. **Ajan sınırları.** AI ajanı UI doğrulamasını geliştirme ortamında yaptı ve Bant1'in register ayarını yanlışlıkla değiştirdi. Kendisi fark etti, geri aldı ve raporladı. → Kural: veri değiştiren her doğrulama sadece izole örnekte (backend 3100 + test DB, frontend 5174).

7. **Çıkış sonrası yönlendirme.** `queryClient.clear()` gözlemcileri bilgilendirmiyordu. Sekme ancak alakasız bir yeniden çizimde login'e geçiyordu.

8. **Sohbet asistanının önerisi (tsconfig).** `moduleResolution: node10` önerdi. TypeScript 7'de kaldırılmış, derleyici hatası verdi. → TypeScript 5.9'a sabitlendi.

9. **Sohbet asistanının önerisi (süreç öldürme).** `lsof -ti :3000 | xargs kill -9` önerdi. Komut 3000'e bağlı Vite sürecini de öldürdü ve yanlış teşhise götüren bir semptom üretti. → `lsof -ti tcp:3000 -sTCP:LISTEN`.

En güçlü üçü: **2, 3 ve 6.**

---

## 7. Ekosistem ve ortam tuzakları

**npm "latest" güvenilir değil:**
- NestJS 12 tamamen ESM → NestJS 11 (legacy etiketi, bakımı sürüyor)
- `prisma` latest = 8.0 RC (Node ≥ 22.18 istiyor), `@prisma/client` latest = 7.10 → üçü de tam olarak 7.10.0'a sabitlendi
- TypeScript 7 `node10` çözümlemesini kaldırdı
- react-router 8, Node ≥ 22.22 istiyor → 7.18

**Prisma 7 + CommonJS:** `prisma-client` generator + `moduleFormat = "cjs"`, driver adapter zorunlu, `prisma.config.ts` `.env`'i kendisi yükler, seed otomatik çalışmaz.

**modbus-serial:**
- Farklı unit id sessizce yok sayılır, istemci timeout alır
- `unitID: 0` → `0 || 255` yüzünden "herkese cevap" moduna düşer
- Varsayılan host `127.0.0.1` (Docker'da dışarıdan erişilemez)
- Tek register okumada farklı getter çağrılır (length-1 tuzağı)
- Tanımsız fonksiyon kodu timeout'a yol açar
- FC16 sessizce `setRegister`'a dağıtılır

**Mosquitto 2.x** varsayılan olarak sadece localhost'u dinler.

**MQTT:**
- Temiz DISCONNECT'te LWT yayınlanmaz
- `mqtt.js` bağlantı yokken QoS 1 mesajlarını örtük olarak biriktirir
- Aynı clientId'li iki istemci birbirini düşürür

**macOS:** Desktop korumalı klasör, Multipass mount içini okuyamadı (`Operation not permitted`) → proje `~/projects`'e taşındı.

**Multipass VM saati kayabilir** → NTP.

**Vite proxy**, upstream kapandığında SSE yanıtını sonlandırmayabilir → istemci bekçisi.

**npm audit uyarıları** Prisma CLI'ın geliştirme bağımlılıklarından geliyor, çalışan uygulamaya girmiyor.

---

## 8. Bilerek yapmadıklarım ve nasıl yapardım

- **Kamera bonusu:** VM'de bir servis (ör. MediaPipe ile yüz ve göz noktaları; göz kapanma oranı, esneme, baş eğimi; kadrajda kişi yok) sadece sınıf + zamanı `factory/desk1/operator` topic'ine yayınlardı. Platformda yeni bir connector türü (factory'de bir `case`). Ham görüntü VM'den hiç çıkmazdı.
- **Platformda MQTT status / LWT dinlemek:** Şu an Bant 2 simülatörü durunca kart STALE oluyor (broker bağlantısı sağlam). Bant 1 durunca OFFLINE. Status aboneliği + bir zod şemasıyla Bant 2 de OFFLINE olurdu.
- **Bağlantı kopukken tampon:** MQTT QoS 1 + kalıcı oturum (`clean: false`) ya da simülatör tarafında kuyruk. Zemin hazır: (device_id, ts) birincil anahtarı + `skipDuplicates` tekrar gönderimde çift kayıt oluşturmaz, `seq` boşlukları gösterir.
- **Olay kaydı** (tablo hazır), **mühendis rolü** (enum + `@Roles`), **eşik alarmı**, **verimlilik göstergesi.**
- **TimescaleDB hypertable** ve 60 dakikadan uzun aralıklar için **downsampling.**
- **Backend'den makine tarafından okunabilir hata kodları** (`LAST_ADMIN` gibi). Şu an frontend sınırlı bir mesaj eşlemesi yapıyor.
- **Parola sıfırlama eski token'ları geçersiz kılmıyor** → token sürümlemesi.
- **Diğer adminlerin Kullanıcılar tablosu canlı güncellenmiyor.**
- **Olay yolu tek süreçte** → birden fazla backend örneğinde Redis pub/sub.
- **Broker kimlik doğrulaması yok** (anonymous) → kimlik bilgileri env / secret'tan.
- **Simülatör restore'da kapalı geçen süreyi simüle etmiyor** (88 °C'de kapanan motor 88 °C'de açılır).
- **Gelecek tarihli `ts` koruması:** `ts`, `receivedAt`'ten belirli bir eşikten fazla ilerideyse logla ve `receivedAt` kullan.
- **Login rate limit.**

---

## 9. Demo için komutlar

**Arıza:**
```bash
mbpoll -m tcp -a 1 -p 5020 -t 4 -r 1 192.168.252.2 2                                          # Bant 1
mosquitto_pub -h 192.168.252.2 -t factory/line2/command -m '{"setState":"fault"}'            # Bant 2
```

**Kaynak durdur / başlat** (VM'de, `~/factoredge/vm`):
```bash
docker compose stop line1-sim    # Bant 1 → Bağlantı yok
docker compose stop line2-sim    # Bant 2 → Veri yok (~3 sn)
docker compose stop mosquitto    # Bant 2 → Bağlantı yok
docker compose start <servis>    # kendiliğinden toparlanır
```

**Yanlış unit id:** Bant 1 → Düzenle → Unit ID 2 → "Bağlantı yok" + timeout hatası → geri 1.

**Ham register okuma:**
```bash
mbpoll -m tcp -a 1 -p 5020 -t 3 -r 1 -c 20 -1 192.168.252.2
```

**Altın değerler:**

| Değer | Register'lar |
|---|---|
| 123456789 (uint32, ABCD) | `[1883, 52501]` → 1883 × 65536 + 52501 |
| 72.5 °C (float32, CDAB) | `[0, 17041]` (0x4291 → 0x42910000) |
| 12.34 A (int16, ×0.01) | `1234` |
| −12.34 A | `64302` (iki tümleyen) |

---

## 10. Açık konular

- README dili (öneri: Türkçe, teknik terimler İngilizce)
- Oturum olayları değişikliğinin commit'i
