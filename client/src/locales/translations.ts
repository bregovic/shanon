
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
    }
};
