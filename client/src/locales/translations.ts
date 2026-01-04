
export type Language = 'cs' | 'en';

export const translations = {
    cs: {
        // Obco
        'common.save': 'Uložit',
        'common.cancel': 'Zrušit',
        'common.close': 'Zavřít',
        'common.loading': 'Načítám...',
        'common.error': 'Chyba',
        'common.success': 'Úspěch',

        // Settings
        'settings.title': 'Nastavení uživatele',
        'settings.language': 'Jazyk',
        'settings.theme': 'Vzhled',
        'settings.theme.light': 'Světlý',
        'settings.theme.dark': 'Tmavý',
        'settings.saved': 'Nastavení uloženo',

        // Import
        'import.unsupported.title': 'Nepodporovaný formát',
        'import.unsupported.desc': 'Tento soubor se nepodařilo rozpoznat. Prosím zkontrolujte formát nebo kontaktujte podporu.',
        'import.contact_support': 'Kontaktovat podporu',
        'import.upload_btn': 'Importovat',
        'import.add_btn': 'Přidat další',
        'import.working': 'Pracuji...',

        // System
        'system.title': 'Konfigurace systému',
        'system.menu.forms': 'Formuláře',
        'system.menu.forms.desc': 'Správa systémových nástrojů a dokumentace',
        'system.menu.reports': 'Reporty',
        'system.menu.reports.desc': 'Systémové přehledy a statistiky',
        'system.menu.tasks': 'Úlohy',
        'system.menu.tasks.desc': 'Dávkové zpracování a periodické úlohy',
        'system.menu.settings': 'Nastavení',
        'system.menu.settings.desc': 'Globální konfigurace aplikace',

        'system.group.admin': 'Nástroje administrátora',
        'system.group.docs': 'Dokumentace',

        'system.item.diagnostics': 'Diagnostika systému',
        'system.item.sessions': 'Systémové relace',
        'system.item.sequences': 'Číselné řady',
        'system.item.db_docs': 'Dokumentace databáze',
        'system.item.manifest': 'Systémový manifest',
        'system.item.security': 'Dokumentace zabezpečení',
        'system.item.history': 'Historie změn',
        'system.item.help': 'Správa nápovědy',
        'system.item.update_db': 'Aktualizace databáze (SQL)',

        'system.diag.db_persisted': 'Uloženo v DB',
        'system.diag.yes': 'ANO',
        'system.diag.no': 'NE',
        'system.diag.session_id': 'ID Relace',
        'system.item.audit_log': 'Auditní log',
        'system.item.performance_stats': 'Statistiky výkonu',
        'system.item.cron_jobs': 'Plánované úlohy (Cron)',
        'system.item.run_indexing': 'Spustit indexaci',
        'system.item.global_params': 'Globální parametry',

        'system.update_db.confirm': 'Opravdu chcete spustit aktualizaci databáze?',
    },

    en: {
        'common.save': 'Save',
        'common.cancel': 'Cancel',
        'common.close': 'Close',
        'common.loading': 'Loading...',
        'common.error': 'Error',
        'common.success': 'Success',

        'settings.title': 'User Settings',
        'settings.language': 'Language',
        'settings.theme': 'Theme',
        'settings.theme.light': 'Light',
        'settings.theme.dark': 'Dark',
        'settings.saved': 'Settings saved',

        'import.unsupported.title': 'Unsupported Format',
        'import.unsupported.desc': 'This file could not be recognized. Please check the format or contact support.',
        'import.contact_support': 'Contact Support',
        'import.upload_btn': 'Import',
        'import.add_btn': 'Add more',
        'import.working': 'Working...',

        // System
        'system.title': 'System Configuration',
        'system.menu.forms': 'Forms',
        'system.menu.forms.desc': 'System tools and documentation management',
        'system.menu.reports': 'Reports',
        'system.menu.reports.desc': 'System overviews and statistics',
        'system.menu.tasks': 'Tasks',
        'system.menu.tasks.desc': 'Batch processing and periodic tasks',
        'system.menu.settings': 'Settings',
        'system.menu.settings.desc': 'Global application configuration',

        'system.group.admin': 'Admin Tools',
        'system.group.docs': 'Documentation',

        'system.item.diagnostics': 'System Diagnostics',
        'system.item.sessions': 'System Sessions',
        'system.item.sequences': 'Number Series',
        'system.item.db_docs': 'Database Documentation',
        'system.item.manifest': 'System Manifest',
        'system.item.security': 'Security Documentation',
        'system.item.history': 'Change History',
        'system.item.help': 'Help Management',
        'system.item.update_db': 'Database Update (SQL)',
        'system.item.audit_log': 'Audit Log',
        'system.item.performance_stats': 'Performance Stats',
        'system.item.cron_jobs': 'Scheduled Tasks (Cron)',
        'system.item.run_indexing': 'Run Indexing',
        'system.item.global_params': 'Global Parameters',

        'system.diag.db_persisted': 'Persisted in DB',
        'system.diag.yes': 'YES',
        'system.diag.no': 'NO',
        'system.diag.session_id': 'Session ID',
        'system.db_persisted': 'Persisted in DB',
        'system.db_handler': 'Session Handler',
        'system.database': 'Database',
        'system.server_db': 'Server & Database',
        'system.session_diag': 'Session Diagnostics',
        'system.yes': 'YES',
        'system.no': 'NO',
        'system.connected': 'Connected',
        'system.php_version': 'PHP Version',
        'system.server_time': 'Server Time',


        'system.update_db.confirm': 'Are you sure you want to run the database update?',
    }
};
