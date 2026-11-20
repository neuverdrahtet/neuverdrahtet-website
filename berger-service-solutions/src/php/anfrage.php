<?php
/**
 * BERGER SERVICE SOLUTIONS – Empfang der Online-Buchung per E-Mail.
 *
 * Nimmt den Lead (Schema bss-lead/1, siehe docs/schemas/lead.schema.json) und
 * optionale Dateien entgegen, prüft alles serverseitig erneut und sendet:
 *   1. eine E-Mail mit allen Angaben, Dateien und lead.json an das Büro,
 *   2. optional eine kurze Eingangsbestätigung an den Kunden.
 *
 * Es werden KEINE Anfragen auf dem Webspace gespeichert. Gespeichert werden nur
 * kurzlebige technische Daten in api/daten/ (gehashte IP für das Rate-Limit,
 * Idempotenzschlüssel für 24 h), geschützt per .htaccess.
 *
 * Diese Datei wird von src/build.mjs nach public/api/ kopiert. Einstellungen
 * stehen in api/einstellungen.php (ebenfalls generiert aus src/config.mjs).
 */
declare(strict_types=1);

date_default_timezone_set('Europe/Berlin');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function antwort(int $status, array $daten): void {
    http_response_code($status);
    echo json_encode($daten, JSON_UNESCAPED_UNICODE);
    exit;
}

// --- Einstellungen ------------------------------------------------------------
$einstellungsDatei = getenv('BSS_EINSTELLUNGEN') ?: __DIR__ . '/einstellungen.php';
$E = is_file($einstellungsDatei) ? require $einstellungsDatei : null;
if (!is_array($E) || empty($E['empfaenger']) || empty($E['absender'])) {
    antwort(503, ['fehler' => ['allgemein' => 'Die Online-Anfrage ist noch nicht eingerichtet. Bitte kontaktieren Sie uns telefonisch oder per E-Mail.']]);
}
$DATEN = $E['datenVerzeichnis'] ?? (__DIR__ . '/daten');

// --- Grundprüfungen -----------------------------------------------------------
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    antwort(405, ['fehler' => ['allgemein' => 'Nur POST erlaubt.']]);
}
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '') {
    $originHost = parse_url($origin, PHP_URL_HOST);
    $erlaubt = array_merge([$_SERVER['HTTP_HOST'] ?? ''], $E['erlaubteHosts'] ?? []);
    $erlaubt = array_map(fn($h) => preg_replace('/:\d+$/', '', strtolower($h)), $erlaubt);
    if (!$originHost || !in_array(strtolower($originHost), $erlaubt, true)) {
        antwort(403, ['fehler' => ['allgemein' => 'Herkunft nicht erlaubt.']]);
    }
}

// --- Datenverzeichnis (geschützt) ---------------------------------------------
function verzeichnis(string $pfad): string {
    if (!is_dir($pfad)) { @mkdir($pfad, 0750, true); }
    return $pfad;
}
verzeichnis($DATEN);
if (!is_file("$DATEN/.htaccess")) {
    @file_put_contents("$DATEN/.htaccess", "Require all denied\nDeny from all\n");
}
$saltDatei = "$DATEN/salt";
if (!is_file($saltDatei)) { @file_put_contents($saltDatei, bin2hex(random_bytes(16))); }
$salt = (string)@file_get_contents($saltDatei);

// --- Rate-Limit pro IP (nur gehasht gespeichert) -----------------------------
$limit = (int)($E['ratenLimit'] ?? 5);
$fenster = (int)($E['ratenFensterSek'] ?? 600);
$ipHash = hash('sha256', $salt . ($_SERVER['REMOTE_ADDR'] ?? ''));
$rateDatei = verzeichnis("$DATEN/rate") . "/$ipHash.json";
$jetzt = time();
$treffer = array_values(array_filter(json_decode((string)@file_get_contents($rateDatei), true) ?: [], fn($t) => is_int($t) && $t > $jetzt - $fenster));
if (count($treffer) >= $limit) {
    antwort(429, ['fehler' => ['allgemein' => 'Zu viele Anfragen in kurzer Zeit. Bitte versuchen Sie es in einigen Minuten erneut.']]);
}
$treffer[] = $jetzt;
@file_put_contents($rateDatei, json_encode($treffer), LOCK_EX);
// Alte Rate-Dateien gelegentlich aufräumen
if (random_int(1, 50) === 1) {
    foreach (glob("$DATEN/rate/*.json") ?: [] as $f) { if (filemtime($f) < $jetzt - $fenster) { @unlink($f); } }
    foreach (glob("$DATEN/idem/*.json") ?: [] as $f) { if (filemtime($f) < $jetzt - 86400) { @unlink($f); } }
}

// --- Lead einlesen ------------------------------------------------------------
$roh = $_POST['lead'] ?? null;
if ($roh === null && isset($_FILES['lead']['tmp_name']) && is_uploaded_file($_FILES['lead']['tmp_name'])) {
    if ($_FILES['lead']['size'] > 200000) { antwort(413, ['fehler' => ['allgemein' => 'Anfrage zu groß.']]); }
    $roh = file_get_contents($_FILES['lead']['tmp_name']);
}
$lead = is_string($roh) ? json_decode($roh, true) : null;
if (!is_array($lead) || ($lead['schemaVersion'] ?? '') !== 'bss-lead/1') {
    antwort(400, ['fehler' => ['allgemein' => 'Ungültige Anfrage.']]);
}

// Bot-Erkennung wie im bestehenden Werkora-Worker: still verwerfen.
$honig = (string)($lead['spamSchutz']['honeypot'] ?? '');
$zeit = $lead['spamSchutz']['ausfuellzeitMs'] ?? null;
if ((is_int($zeit) && $zeit < 3000) || ($honig !== '' && (!is_int($zeit) || $zeit < 10000))) {
    antwort(200, ['vorgangsnummer' => 'W-' . date('Ymd') . '-' . strtoupper(bin2hex(random_bytes(3))), 'status' => 'neu']);
}

// --- Idempotenz -----------------------------------------------------------------
$idemSchluessel = (string)($_SERVER['HTTP_IDEMPOTENCY_KEY'] ?? ($lead['idempotenzSchluessel'] ?? ''));
$idemDatei = null;
if (preg_match('/^[A-Za-z0-9._-]{8,80}$/', $idemSchluessel)) {
    $idemDatei = verzeichnis("$DATEN/idem") . '/' . hash('sha256', $salt . $idemSchluessel) . '.json';
    $vorher = json_decode((string)@file_get_contents($idemDatei), true);
    if (is_array($vorher) && ($vorher['zeit'] ?? 0) > $jetzt - 86400) {
        antwort(200, ['vorgangsnummer' => $vorher['nummer'], 'status' => 'bereits-eingegangen']);
    }
}

// --- Validierung ----------------------------------------------------------------
$fehler = [];
function txt($wert, int $max): string {
    $s = is_scalar($wert) ? (string)$wert : '';
    $s = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $s) ?? '';
    return mb_substr(trim($s), 0, $max);
}
$katalog = $E['leistungen'] ?? [];
$slug = txt($lead['leistung']['slug'] ?? '', 80);
if (!isset($katalog[$slug])) { $fehler['leistung'] = 'Unbekannte Leistung.'; }
$leistung = $katalog[$slug] ?? ['name' => '', 'buchung' => 'anfrage', 'bereich' => ''];

$o = $lead['einsatzort'] ?? [];
$ort = [
    'strasse' => txt($o['strasse'] ?? '', 120), 'hausnummer' => txt($o['hausnummer'] ?? '', 20),
    'plz' => txt($o['plz'] ?? '', 5), 'ort' => txt($o['ort'] ?? '', 80), 'zusatz' => txt($o['zusatz'] ?? '', 120),
];
if (mb_strlen($ort['strasse']) < 3) { $fehler['strasse'] = 'Bitte Straße angeben.'; }
if (!preg_match('/^\d+\s*[a-zA-Z]?([-\/]\s*\d+\s*[a-zA-Z]?)?$/', $ort['hausnummer'])) { $fehler['hausnummer'] = 'Bitte eine gültige Hausnummer angeben.'; }
if (!preg_match('/^\d{5}$/', $ort['plz'])) { $fehler['plz'] = 'Bitte eine fünfstellige PLZ angeben.'; }
if (mb_strlen($ort['ort']) < 2) { $fehler['ort'] = 'Bitte den Ort angeben.'; }
$eg = $o['einsatzgebiet'] ?? [];
$egStatus = in_array($eg['status'] ?? '', ['im-gebiet', 'ausserhalb', 'manuell-pruefen'], true) ? $eg['status'] : 'manuell-pruefen';
$egZone = preg_match('/^[A-D]$/', (string)($eg['zone'] ?? '')) ? $eg['zone'] : null;

$k = $lead['kunde'] ?? [];
$kunde = [
    'typ' => in_array($k['typ'] ?? '', ['privat', 'vermieter', 'hausverwaltung', 'gewerbe'], true) ? $k['typ'] : 'privat',
    'firma' => txt($k['firma'] ?? '', 120), 'vorname' => txt($k['vorname'] ?? '', 80), 'nachname' => txt($k['nachname'] ?? '', 80),
    'telefon' => txt($k['telefon'] ?? '', 20), 'email' => strtolower(txt($k['email'] ?? '', 160)),
    'kontaktweg' => in_array($k['bevorzugterKontaktweg'] ?? '', ['telefon', 'email', 'whatsapp'], true) ? $k['bevorzugterKontaktweg'] : 'telefon',
];
if ($kunde['vorname'] === '') { $fehler['vorname'] = 'Bitte den Vornamen angeben.'; }
if ($kunde['nachname'] === '') { $fehler['nachname'] = 'Bitte den Nachnamen angeben.'; }
if (!filter_var($kunde['email'], FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n,;]/', $kunde['email'])) { $fehler['email'] = 'Bitte eine gültige E-Mail-Adresse angeben.'; }
if (!preg_match('/^\+\d{8,15}$/', $kunde['telefon'])) { $fehler['telefon'] = 'Bitte eine gültige Telefonnummer angeben.'; }

$d = $lead['details'] ?? [];
$details = [
    'beschreibung' => txt($d['beschreibung'] ?? '', 5000),
    'anzahlGeraete' => (is_int($d['anzahlGeraete'] ?? null) && $d['anzahlGeraete'] > 0 && $d['anzahlGeraete'] <= 5000) ? $d['anzahlGeraete'] : null,
    'anlage' => txt($d['anlage'] ?? '', 200),
    'flaecheM2' => (is_numeric($d['flaecheM2'] ?? null) && $d['flaecheM2'] > 0 && $d['flaecheM2'] <= 100000) ? $d['flaecheM2'] + 0 : null,
];
if (mb_strlen($details['beschreibung']) < 15) { $fehler['beschreibung'] = 'Bitte beschreiben Sie die Arbeiten etwas genauer.'; }

$t = $lead['termin'] ?? [];
$termin = [
    'datum' => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($t['datum'] ?? '')) ? $t['datum'] : null,
    'zeit' => preg_match('/^\d{2}:\d{2}$/', (string)($t['zeit'] ?? '')) ? $t['zeit'] : null,
    'zeitfenster' => in_array($t['zeitfenster'] ?? '', ['egal', 'vormittag', 'nachmittag'], true) ? $t['zeitfenster'] : null,
];
if ($leistung['buchung'] === 'direkt' && (!$termin['datum'] || !$termin['zeit'])) { $fehler['slot'] = 'Bitte einen Wunschtermin auswählen.'; }

$rechnung = null;
if (is_array($lead['rechnungsadresse'] ?? null)) {
    $r = $lead['rechnungsadresse'];
    $rechnung = ['name' => txt($r['name'] ?? '', 120), 'strasse' => txt($r['strasse'] ?? '', 120), 'hausnummer' => txt($r['hausnummer'] ?? '', 20), 'plz' => txt($r['plz'] ?? '', 5), 'ort' => txt($r['ort'] ?? '', 80)];
    if ($rechnung['name'] === '' || mb_strlen($rechnung['strasse']) < 3 || !preg_match('/^\d{5}$/', $rechnung['plz']) || mb_strlen($rechnung['ort']) < 2) {
        $fehler['rName'] = 'Bitte die Rechnungsadresse vollständig angeben.';
    }
}
if (($lead['einwilligungen']['datenschutz']['erteilt'] ?? false) !== true) { $fehler['datenschutz'] = 'Bitte bestätigen Sie die Datenschutzhinweise.'; }
$whatsapp = ($lead['einwilligungen']['whatsapp']['erteilt'] ?? false) === true;

// --- Dateien ----------------------------------------------------------------------
$anhaenge = [];
$erlaubteTypen = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/heic' => 'heic', 'image/heif' => 'heic', 'application/pdf' => 'pdf'];
$maxDateien = (int)($E['maxDateien'] ?? 6);
$maxDateiByte = (int)($E['maxDateiMB'] ?? 10) * 1048576;
$maxGesamtByte = (int)($E['maxGesamtMB'] ?? 20) * 1048576;
$f = $_FILES['dateien'] ?? null;
if (is_array($f) && isset($f['name'])) {
    $namen = (array)$f['name']; $tmp = (array)$f['tmp_name']; $grossen = (array)$f['size']; $codes = (array)$f['error'];
    $anzahl = count(array_filter($codes, fn($c) => $c !== UPLOAD_ERR_NO_FILE));
    if ($anzahl > $maxDateien) { $fehler['dateien'] = "Bitte höchstens $maxDateien Dateien senden."; }
    $gesamt = 0;
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    foreach ($namen as $i => $name) {
        if (isset($fehler['dateien'])) { break; }
        if (($codes[$i] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) { continue; }
        if ($codes[$i] !== UPLOAD_ERR_OK || !is_uploaded_file($tmp[$i])) { $fehler['dateien'] = 'Eine Datei konnte nicht übertragen werden.'; break; }
        $gesamt += $grossen[$i];
        if ($grossen[$i] > $maxDateiByte) { $fehler['dateien'] = 'Eine Datei ist zu groß.'; break; }
        if ($gesamt > $maxGesamtByte) { $fehler['dateien'] = 'Die Dateien sind zusammen zu groß.'; break; }
        $typ = $finfo->file($tmp[$i]) ?: '';
        if (!isset($erlaubteTypen[$typ])) { $fehler['dateien'] = 'Eine Datei hat ein nicht unterstütztes Format.'; break; }
        $basis = preg_replace('/[^A-Za-z0-9._-]+/', '-', pathinfo((string)$name, PATHINFO_FILENAME)) ?: 'datei';
        $anhaenge[] = ['name' => mb_substr($basis, 0, 60) . '.' . $erlaubteTypen[$typ], 'typ' => $typ, 'inhalt' => file_get_contents($tmp[$i])];
    }
}

if ($fehler) { antwort(400, ['fehler' => $fehler]); }

// --- E-Mails --------------------------------------------------------------------
$nummer = 'W-' . date('Ymd') . '-' . strtoupper(bin2hex(random_bytes(3)));
$firmaName = $E['firma'] ?? 'BERGER SERVICE SOLUTIONS';
$absender = $E['absender'];
$istDirekt = $leistung['buchung'] === 'direkt';
$kundentypText = ['privat' => 'Privatkunde', 'vermieter' => 'Vermieter / Eigentümer', 'hausverwaltung' => 'Hausverwaltung', 'gewerbe' => 'Gewerbekunde'][$kunde['typ']];
$terminText = $istDirekt
    ? ($termin['datum'] ? date('d.m.Y', strtotime($termin['datum'])) . ', ' . $termin['zeit'] . ' Uhr (vorläufig, bitte bestätigen)' : '–')
    : ($termin['datum'] ? date('d.m.Y', strtotime($termin['datum'])) . ' (' . ($termin['zeitfenster'] ?? 'egal') . ')' : 'kein Wunschtermin');

$zeilen = [
    ($istDirekt ? 'NEUE TERMINBUCHUNG' : 'NEUE ANFRAGE') . " – Vorgang $nummer",
    str_repeat('=', 60),
    '', 'LEISTUNG', "  {$leistung['name']}" . ($istDirekt ? ' (direkt buchbar)' : ' (Besichtigung & Angebot)'),
    "  Termin: $terminText",
    '', 'EINSATZORT',
    "  {$ort['strasse']} {$ort['hausnummer']}, {$ort['plz']} {$ort['ort']}" . ($ort['zusatz'] ? " ({$ort['zusatz']})" : ''),
    '  Einsatzgebiet laut Website: ' . ['im-gebiet' => 'im Gebiet', 'ausserhalb' => 'außerhalb des Radius', 'manuell-pruefen' => 'manuell prüfen'][$egStatus] . ($egZone ? ", Zone $egZone" : ''),
    '', 'KUNDE',
    "  {$kunde['vorname']} {$kunde['nachname']}" . ($kunde['firma'] ? " – {$kunde['firma']}" : '') . " ($kundentypText)",
    "  Telefon: {$kunde['telefon']}", "  E-Mail:  {$kunde['email']}",
    '  Bevorzugter Kontaktweg: ' . $kunde['kontaktweg'] . ($kunde['kontaktweg'] === 'whatsapp' ? ($whatsapp ? ' (Einwilligung erteilt)' : ' (KEINE Einwilligung – nicht per WhatsApp schreiben)') : ''),
];
if ($rechnung) { array_push($zeilen, '', 'ABWEICHENDE RECHNUNGSADRESSE', "  {$rechnung['name']}, {$rechnung['strasse']} {$rechnung['hausnummer']}, {$rechnung['plz']} {$rechnung['ort']}"); }
array_push($zeilen, '', 'BESCHREIBUNG', '  ' . str_replace("\n", "\n  ", $details['beschreibung']));
if ($details['anzahlGeraete']) { $zeilen[] = "  Anzahl Geräte: {$details['anzahlGeraete']}"; }
if ($details['anlage']) { $zeilen[] = "  Anlage: {$details['anlage']}"; }
if ($details['flaecheM2']) { $zeilen[] = "  Fläche: {$details['flaecheM2']} m²"; }
array_push($zeilen, '', 'ANHÄNGE: ' . (count($anhaenge) ? implode(', ', array_column($anhaenge, 'name')) : 'keine') . ' + lead.json (für Werkora)',
    '', '---', 'Datenschutz-Einwilligung erteilt am ' . date('d.m.Y H:i') . ' (Website-Formular).',
    'Antworten Sie direkt auf diese E-Mail, um den Kunden zu erreichen.');
$text = implode("\n", $zeilen) . "\n";

$sauber = [
    'schemaVersion' => 'bss-lead/1', 'vorgangsnummer' => $nummer, 'eingegangenAm' => date('c'),
    'quelle' => ['kanal' => 'website', 'seite' => 'buchen.html', 'kampagne' => is_array($lead['quelle']['kampagne'] ?? null) ? array_map(fn($v) => txt($v, 80), $lead['quelle']['kampagne']) : null],
    'vorgangsart' => $istDirekt ? 'buchung' : 'anfrage',
    'leistung' => ['slug' => $slug, 'name' => $leistung['name'], 'bereich' => $leistung['bereich']],
    'einsatzort' => $ort + ['einsatzgebiet' => ['status' => $egStatus, 'zone' => $egZone]],
    'rechnungsadresse' => $rechnung, 'kunde' => $kunde, 'details' => $details, 'termin' => $termin,
    'einwilligungen' => ['datenschutz' => true, 'whatsapp' => $whatsapp],
    'dubletten' => array_map(fn($v) => is_string($v) && preg_match('/^[0-9a-f]{64}$/', $v) ? $v : null, (array)($lead['dubletten'] ?? [])),
];
$anhaenge[] = ['name' => "lead-$nummer.json", 'typ' => 'application/json', 'inhalt' => json_encode($sauber, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)];

function sendeMail(string $an, string $von, string $vonName, ?string $antwortAn, string $betreff, string $text, array $anhaenge): bool {
    $grenze = '=_bss_' . bin2hex(random_bytes(12));
    $kopf = [
        'From: ' . mb_encode_mimeheader($vonName, 'UTF-8', 'Q') . " <$von>",
        'MIME-Version: 1.0',
        'X-Mailer: BSS-Website',
    ];
    if ($antwortAn) { $kopf[] = "Reply-To: $antwortAn"; }
    if ($anhaenge) {
        $kopf[] = "Content-Type: multipart/mixed; boundary=\"$grenze\"";
        $rumpf = "--$grenze\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($text));
        foreach ($anhaenge as $a) {
            $rumpf .= "--$grenze\r\nContent-Type: {$a['typ']}; name=\"{$a['name']}\"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename=\"{$a['name']}\"\r\n\r\n" . chunk_split(base64_encode($a['inhalt']));
        }
        $rumpf .= "--$grenze--\r\n";
    } else {
        $kopf[] = 'Content-Type: text/plain; charset=UTF-8';
        $kopf[] = 'Content-Transfer-Encoding: base64';
        $rumpf = chunk_split(base64_encode($text));
    }
    return mail($an, mb_encode_mimeheader($betreff, 'UTF-8', 'Q'), $rumpf, implode("\r\n", $kopf), '-f' . $von);
}

$betreff = '[Website] ' . ($istDirekt ? 'Terminbuchung' : 'Anfrage') . ": {$leistung['name']} – {$ort['plz']} {$ort['ort']}" . ($egZone ? " (Zone $egZone)" : '') . " – $nummer";
if (!sendeMail($E['empfaenger'], $absender, "$firmaName Website", $kunde['email'], $betreff, $text, $anhaenge)) {
    error_log("BSS: Versand der Anfrage $nummer fehlgeschlagen");
    antwort(500, ['fehler' => ['allgemein' => 'Die Anfrage konnte gerade nicht versendet werden. Bitte versuchen Sie es erneut oder rufen Sie uns an.']]);
}

// Eingangsbestätigung an den Kunden: nur feste Texte, keine Kundeneingaben
// (verhindert, dass das Formular zum Versand fremder Inhalte missbraucht wird).
if (!empty($E['kundenbestaetigung'])) {
    $kText = "Guten Tag,\n\nvielen Dank für Ihre " . ($istDirekt ? 'Terminanfrage' : 'Anfrage') . " bei $firmaName.\n\n"
        . "Vorgangsnummer: $nummer\nLeistung: {$leistung['name']}\n\n"
        . ($istDirekt
            ? "Wir gleichen Ihren Wunschtermin mit unserem Kalender ab und bestätigen ihn gesondert. Erst mit dieser Bestätigung ist der Termin verbindlich.\n"
            : "Wir prüfen Ihre Angaben und melden uns zur Vereinbarung einer Besichtigung. Danach erhalten Sie ein schriftliches Angebot.\n")
        . "\nWenn Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren.\n\nMit freundlichen Grüßen\n$firmaName\n"
        . ($E['telefon'] ? "Telefon: {$E['telefon']}\n" : '') . ($E['website'] ? "{$E['website']}\n" : '');
    sendeMail($kunde['email'], $absender, $firmaName, $E['empfaenger'], "Ihre Anfrage bei $firmaName – $nummer", $kText, []);
}

if ($idemDatei) { @file_put_contents($idemDatei, json_encode(['nummer' => $nummer, 'zeit' => $jetzt]), LOCK_EX); }
antwort(200, ['vorgangsnummer' => $nummer, 'status' => 'neu']);
