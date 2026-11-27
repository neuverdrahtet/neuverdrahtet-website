<?php
/**
 * Plugin Name: BERGER SERVICE SOLUTIONS – Website
 * Description: Liefert die statische Website aus wp-content/bss-website/ unter der Haupt-Domain aus. WordPress-Verwaltung (/wp-admin, /wp-login.php) bleibt erreichbar.
 * Version: 1.0
 *
 * Für IONOS Managed WordPress, bei dem SFTP nur auf /public/wp-content zugreifen darf.
 * Diese Datei gehört nach wp-content/mu-plugins/ ("Must-Use"-Plugins werden
 * automatisch geladen und können im Backend nicht versehentlich deaktiviert werden).
 * Erzeugt von berger-service-solutions/src/paket.mjs – nicht von Hand ändern.
 */
if (!defined('ABSPATH')) { exit; }

(function () {
    if (PHP_SAPI === 'cli' || (defined('DOING_CRON') && DOING_CRON) || (defined('WP_CLI') && WP_CLI)) { return; }
    if (function_exists('is_admin') && is_admin()) { return; }

    $wurzel = rtrim(WP_CONTENT_DIR, '/') . '/bss-website';
    $pfad = rawurldecode((string)parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH));

    // WordPress-eigene Pfade unverändert lassen
    foreach (['/wp-admin', '/wp-login.php', '/wp-json', '/wp-cron.php', '/xmlrpc.php', '/wp-content/', '/wp-includes/', '/wp-signup.php', '/wp-activate.php'] as $wp) {
        if (strpos($pfad, $wp) === 0) { return; }
    }
    if (isset($_GET['rest_route']) || isset($_GET['p']) || isset($_GET['page_id']) || isset($_GET['preview'])) { return; }
    // Immer auf https://<Hauptdomain> umleiten (http und www), nur für die eigene Domain
    $sicher = (function_exists('is_ssl') && is_ssl()) || (($_SERVER['SERVER_PORT'] ?? '') == 443)
        || strtolower($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https' || strtolower($_SERVER['HTTP_X_FORWARDED_SSL'] ?? '') === 'on';
    $host = strtolower(preg_replace('/:\d+$/', '', (string)($_SERVER['HTTP_HOST'] ?? '')));
    if (defined('BSS_DOMAIN') && ($host === BSS_DOMAIN || $host === 'www.' . BSS_DOMAIN) && (!$sicher || $host !== BSS_DOMAIN)
        && in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD'], true)) {
        header('Location: https://' . BSS_DOMAIN . ($_SERVER['REQUEST_URI'] ?? '/'), true, 301);
        exit;
    }
    if (strpos($pfad, "\0") !== false || preg_match('#(^|/)\.\.?(/|$)#', $pfad)) { $pfad = '/404.html'; }

    if (substr($pfad, -1) === '/') { $pfad .= 'index.html'; }
    $datei = realpath($wurzel . $pfad);
    $wurzelEcht = realpath($wurzel);
    if ($wurzelEcht === false) { return; } // Paket nicht hochgeladen: WordPress normal anzeigen

    $gefunden = $datei !== false && strpos($datei, $wurzelEcht . '/') === 0 && is_file($datei);
    $name = $gefunden ? basename($datei) : '';
    // Versteckte und interne Dateien nie ausliefern
    if ($gefunden && ($name[0] === '.' || strpos($datei, $wurzelEcht . '/api/daten/') === 0)) { $gefunden = false; }

    // Einzige ausführbare PHP-Datei: der Empfang der Online-Buchung
    if ($gefunden && substr($name, -4) === '.php') {
        if ($datei === $wurzelEcht . '/api/anfrage.php') { require $datei; exit; }
        $gefunden = false;
    }

    $status = 200;
    if (!$gefunden) {
        $status = 404;
        $datei = $wurzelEcht . '/404.html';
        if (!is_file($datei)) { return; }
    }

    $typen = [
        'html' => 'text/html; charset=utf-8', 'css' => 'text/css; charset=utf-8', 'js' => 'text/javascript; charset=utf-8',
        'mjs' => 'text/javascript; charset=utf-8', 'json' => 'application/json', 'svg' => 'image/svg+xml',
        'webp' => 'image/webp', 'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'ico' => 'image/x-icon',
        'woff2' => 'font/woff2', 'xml' => 'application/xml; charset=utf-8', 'txt' => 'text/plain; charset=utf-8',
    ];
    $endung = strtolower(pathinfo($datei, PATHINFO_EXTENSION));
    if (!isset($typen[$endung])) { $status = 404; $datei = $wurzelEcht . '/404.html'; $endung = 'html'; }

    while (ob_get_level() > 0) { ob_end_clean(); }
    http_response_code($status);
    header('Content-Type: ' . $typen[$endung]);
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    header('X-Frame-Options: SAMEORIGIN');
    if ($sicher && defined('BSS_DOMAIN') && $host === BSS_DOMAIN) { header('Strict-Transport-Security: max-age=31536000'); }
    if (!BSS_INDEXIERBAR) { header('X-Robots-Tag: noindex, nofollow'); }
    $geaendert = filemtime($datei);
    header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $geaendert) . ' GMT');
    header('Cache-Control: ' . ($endung === 'html' ? 'public, max-age=300' : (in_array($endung, ['css', 'js', 'mjs'], true) ? 'public, max-age=86400' : 'public, max-age=2592000')));
    if ($status === 200 && isset($_SERVER['HTTP_IF_MODIFIED_SINCE']) && strtotime($_SERVER['HTTP_IF_MODIFIED_SINCE']) >= $geaendert) {
        http_response_code(304); exit;
    }
    header('Content-Length: ' . filesize($datei));
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') { readfile($datei); }
    exit;
})();
